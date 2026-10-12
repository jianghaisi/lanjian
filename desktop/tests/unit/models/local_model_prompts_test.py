"""No weights, inference package or network; real bundled templates and stream filter."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src/main/modules/models/adapters/local-models'))
from text_prompts import prompt_for, safe_content, stop_tokens, VisibleOutput, PROFILES


class Templates(unittest.TestCase):
    def test_existing_qwen_template_is_preserved(self):
        self.assertEqual(prompt_for([{'role': 'user', 'content': '雨夜'}]), '<|im_start|>user\n雨夜<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')

    def test_roles_and_text_survive_all_profiles(self):
        rows = [{'role': role, 'content': content} for role, content in [('system', '固定规则'), ('user', '开场'), ('assistant', '前文'), ('user', '继续')]]
        for profile in PROFILES:
            with self.subTest(profile=profile):
                output = prompt_for(rows, profile)
                for text in ['固定规则', '开场', '前文', '继续']:
                    self.assertEqual(output.count(text), 1)
                self.assertLess(output.index('开场'), output.index('前文'))
                self.assertLess(output.index('前文'), output.index('继续'))
                self.assertTrue(stop_tokens(profile))
                if profile not in ('qwen3', 'deepseek-r1'):
                    self.assertNotIn('<think>', output)

    def test_family_control_tokens_are_not_interchangeable(self):
        rows = [{'role': 'user', 'content': '你好'}]
        self.assertEqual(prompt_for(rows, 'phi3'), '<|user|>\n你好<|end|>\n<|assistant|>\n')
        self.assertEqual(prompt_for(rows, 'glm4'), '[gMASK]<sop><|user|>\n你好<|assistant|>')
        self.assertEqual(prompt_for(rows, 'mistral-instruct'), '<s>[INST] 你好[/INST]')
        self.assertTrue(prompt_for(rows, 'deepseek-r1').endswith('<｜Assistant｜><think>\n'))
        self.assertTrue(prompt_for(rows, 'deepseek-r1', True).endswith('</think>\n\n'))

    def test_all_author_delimiters_are_inert(self):
        tokens = ['<|im_start|>', '<｜User｜>', '<s>', '</s>', '[INST]', '[/INST]', '[gMASK]', '<sop>', '<think>', '</think>']
        for token in tokens:
            self.assertNotIn(token, safe_content('引文' + token + '作者文本'))

    def test_mistral_combines_adjacent_messages_without_losing_system_instructions(self):
        rows = [{'role': role, 'content': value} for role, value in [('system', '规则一'), ('system', '规则二'), ('user', '用户一'), ('user', '用户二'), ('assistant', '助手一'), ('assistant', '助手二'), ('user', '继续')]]
        output = prompt_for(rows, 'mistral-instruct')
        self.assertEqual(output.count('[INST]'), 2)
        self.assertIn('用户一\n\n用户二', output)
        self.assertIn(' 助手一\n\n助手二</s>', output)
        self.assertIn('[INST] 规则一\n\n规则二\n\n继续[/INST]', output)

    def test_invalid_profile_roles_and_unrepresentable_turns_fail(self):
        for profile, rows in [('unknown', [{'role': 'user', 'content': 'x'}]), ('qwen3', []), ('glm4', [{'role': 'tool', 'content': 'x'}]), ('chatml', [{'role': 'user', 'content': 'x', 'extra': 1}]), ('mistral-instruct', [{'role': 'assistant', 'content': 'x'}])]:
            with self.assertRaises(ValueError): prompt_for(rows, profile)

    def test_reasoning_is_hidden_at_every_marker_boundary(self):
        value = '内部思考不进入正文</think>\n雨夜来信'
        for offset in range(len(value) + 1):
            output = VisibleOutput(True)
            result = output.push(value[:offset]) + output.push(value[offset:])
            output.finish()
            self.assertEqual(result, '\n雨夜来信')
        output = VisibleOutput(True)
        self.assertEqual(''.join(output.push(c) for c in value), '\n雨夜来信')
        output.finish()

    def test_incomplete_thought_fails_and_non_reasoning_output_is_unchanged(self):
        output = VisibleOutput(True)
        self.assertEqual(output.push('只思考' * 10000), '')
        self.assertLessEqual(len(output.pending), 7)
        with self.assertRaisesRegex(ValueError, 'REASONING_INCOMPLETE'): output.finish()
        output = VisibleOutput(False)
        self.assertEqual(output.push('{"status":"ok"}'), '{"status":"ok"}')
        output.finish()


if __name__ == '__main__':
    unittest.main()
