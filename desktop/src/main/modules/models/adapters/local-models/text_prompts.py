"""Bundled text templates. No model code, template evaluation or network."""

PROFILES = ("qwen3", "chatml", "phi3", "mistral-instruct", "glm4", "deepseek-r1")


def safe_content(text):
    # Protect each family's delimiters, including DeepSeek's full-width bar.
    for token in ("<|", "<｜", "<s>", "</s>", "<sop>", "[gMASK]", "[INST]", "[/INST]", "<think>", "</think>"):
        text = text.replace(token, token[0] + "\u200b" + token[1:])
    return text


def prompt_for(messages, profile="qwen3", structured=False):
    if profile not in PROFILES or not isinstance(messages, list) or not 1 <= len(messages) <= 64:
        raise ValueError("INPUT_INVALID")
    rows = []
    for message in messages:
        if not isinstance(message, dict) or set(message) != {"role", "content"}:
            raise ValueError("INPUT_INVALID")
        role, content = message["role"], message["content"]
        if role not in ("system", "user", "assistant") or not isinstance(content, str) or len(content) > 250000:
            raise ValueError("INPUT_INVALID")
        rows.append((role, safe_content(content)))
    if profile in ("qwen3", "chatml"):
        result = "".join("<|im_start|>" + role + "\n" + content + "<|im_end|>\n" for role, content in rows)
        return result + "<|im_start|>assistant\n" + ("<think>\n\n</think>\n\n" if profile == "qwen3" else "")
    if profile == "phi3":
        return "".join("<|" + role + "|>\n" + content + "<|end|>\n" for role, content in rows) + "<|assistant|>\n"
    if profile == "glm4":
        ordered = [row for row in rows if row[0] == "system"] + [row for row in rows if row[0] != "system"]
        return "[gMASK]<sop>" + "".join("<|" + role + "|>\n" + content for role, content in ordered) + "<|assistant|>"
    system = "\n\n".join(content for role, content in rows if role == "system")
    if profile == "deepseek-r1":
        result = "<｜begin▁of▁sentence｜>" + system
        for role, content in rows:
            if role == "user":
                result += "<｜User｜>" + content
            elif role == "assistant":
                result += "<｜Assistant｜>" + content + "<｜end▁of▁sentence｜>"
        # JSON requests prefill an ended thought before constrained generation.
        return result + "<｜Assistant｜><think>\n" + ("\n</think>\n\n" if structured else "")
    turns = []
    for role, content in rows:
        if role == "system":
            continue
        if turns and turns[-1][0] == role:
            turns[-1] = (role, turns[-1][1] + "\n\n" + content)
        else:
            turns.append((role, content))
    if not turns or turns[0][0] != "user" or turns[-1][0] != "user":
        raise ValueError("INPUT_INVALID")
    result = "<s>"
    for index, (role, content) in enumerate(turns):
        if role == "user":
            instruction = system + "\n\n" + content if index == len(turns) - 1 and system else content
            result += "[INST] " + instruction + "[/INST]"
        else:
            result += " " + content + "</s>"
    return result


def stop_tokens(profile):
    return {
        "qwen3": ["<|im_end|>", "<|endoftext|>"],
        "chatml": ["<|im_end|>", "<|endoftext|>"],
        "phi3": ["<|end|>", "<|endoftext|>", "<|user|>"],
        "glm4": ["<|user|>", "<|endoftext|>", "<|observation|>"],
        "deepseek-r1": ["<｜end▁of▁sentence｜>", "<｜User｜>"],
        "mistral-instruct": ["</s>", "[INST]"],
    }[profile]


class VisibleOutput:
    """Hide the prefixed R1 thought, including split closing markers."""
    def __init__(self, reasoning=False):
        self.reasoning = reasoning
        self.pending = ""

    def push(self, text):
        if not self.reasoning:
            return text
        self.pending += text
        marker = "</think>"
        position = self.pending.find(marker)
        if position == -1:
            self.pending = self.pending[-(len(marker) - 1):]
            return ""
        visible = self.pending[position + len(marker):]
        self.pending = ""
        self.reasoning = False
        return visible

    def finish(self):
        if self.reasoning:
            raise ValueError("REASONING_INCOMPLETE")
