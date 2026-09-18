"""Private pipe lifecycle fixture. No models, sockets or files are accessed."""
import json
import os
import struct
import sys
import time
import uuid

instance_id = str(uuid.uuid4())


def send(header, pcm=b''):
    raw = json.dumps(dict(header, pcmBytes=len(pcm))).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(raw)) + raw + pcm)
    sys.stdout.buffer.flush()


while True:
    length = sys.stdin.buffer.read(4)
    if not length:
        break
    request = json.loads(sys.stdin.buffer.read(struct.unpack('<I', length)[0]))
    base = {'v': 1, 'id': request['id']}
    if request.get('text') == 'drain':
        send(dict(base, kind='audio', seq=0, sampleRate=24000), b'\x10\x00' * 2400)
        time.sleep(0.5)
        send(dict(base, kind='audio', seq=1, sampleRate=24000), b'\x10\x00' * 2400)
    if request.get('text') == 'wait':
        send(dict(base, kind='delta', text=str(os.getpid())))
        time.sleep(15)
    send(dict(base, ok=True, text='fixture', pid=os.getpid(), instance=instance_id,
              leaked=any(key in os.environ for key in ('HTTPS_PROXY', 'OPENAI_API_KEY'))))
