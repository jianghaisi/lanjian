"""Offline text-only inference, fixed private pipe. No tools, network or novel storage."""
import contextlib
import json
import os
from pathlib import Path
import struct
import sys
import time

ROOT = Path(sys.argv[1]).resolve(strict=True)
BOOTSTRAP = json.loads(sys.argv[2])
if set(BOOTSTRAP) != {"modelPath", "sitePackages", "promptProfile"}:
    raise ValueError("BOOTSTRAP_INVALID")
MODEL_PATH = Path(BOOTSTRAP["modelPath"]).resolve(strict=True)
PACKAGES = Path(BOOTSTRAP["sitePackages"]).resolve(strict=True)
if not MODEL_PATH.is_file() or not PACKAGES.is_dir():
    raise ValueError("BOOTSTRAP_INVALID")
sys.path.insert(0, str(PACKAGES))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from text_prompts import PROFILES, prompt_for, stop_tokens, VisibleOutput
PROFILE = BOOTSTRAP["promptProfile"]
if PROFILE not in PROFILES:
    raise ValueError("BOOTSTRAP_INVALID")
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
INPUT, OUTPUT = sys.stdin.buffer, sys.stdout.buffer
MODEL = None
MAX_FRAME = 1024 * 1024

def exact(size):
    data = bytearray()
    while len(data) < size:
        part = INPUT.read(size-len(data))
        if not part:
            raise EOFError()
        data.extend(part)
    return bytes(data)

def send(value):
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(raw) > MAX_FRAME:
        raise ValueError("OUTPUT_LIMIT")
    OUTPUT.write(struct.pack("<I", len(raw)) + raw)
    OUTPUT.flush()

def infer(request):
    global MODEL
    allowed = {"v","id","action","messages","maxTokens","temperature","topP","schema"}
    if set(request)-allowed or request.get("v")!=1 or request.get("action") not in ("complete","tokenize"):
        raise ValueError("INPUT_INVALID")
    messages=request.get("messages")
    if not isinstance(messages,list) or not 1<=len(messages)<=64:
        raise ValueError("INPUT_INVALID")
    max_tokens=request.get("maxTokens")
    if type(max_tokens) is not int or not 1<=max_tokens<=4096:
        raise ValueError("OUTPUT_BUDGET")
    temperature,top_p=request.get("temperature"),request.get("topP")
    if not isinstance(temperature,(int,float)) or not 0<=temperature<=2 or not isinstance(top_p,(int,float)) or not 0<=top_p<=1:
        raise ValueError("INPUT_INVALID")
    started=time.perf_counter()
    from llama_cpp import Llama, LlamaGrammar
    if MODEL is None:
        MODEL=Llama(model_path=str(MODEL_PATH),n_ctx=8192,n_threads=4,n_threads_batch=4,n_gpu_layers=0,verbose=False)
    prompt=prompt_for(messages, PROFILE, request.get("schema") is not None)
    tokens=MODEL.tokenize(prompt.encode("utf-8"),add_bos=False,special=True)
    if len(tokens)+max_tokens>8192:
        raise ValueError("CONTEXT_LIMIT")
    if request["action"]=="tokenize":
        return {"content":"","finishReason":"stop","promptTokens":len(tokens),"completionTokens":0,"seconds":time.perf_counter()-started}
    schema=request.get("schema")
    if schema is not None and (not isinstance(schema,dict) or len(json.dumps(schema))>32000):
        raise ValueError("INPUT_INVALID")
    grammar=LlamaGrammar.from_json_schema(json.dumps(schema,ensure_ascii=False),verbose=False) if schema is not None else None
    result="";raw_result="";sequence=0;finish=None;first=None
    visible=VisibleOutput(PROFILE=="deepseek-r1" and schema is None)
    for chunk in MODEL.create_completion(prompt=tokens,max_tokens=max_tokens,temperature=temperature,top_p=top_p,stream=True,
                                         stop=stop_tokens(PROFILE),grammar=grammar,seed=42):
        choice=chunk["choices"][0];delta=choice.get("text","")
        finish=choice.get("finish_reason") or finish
        raw_result+=delta
        if len(raw_result.encode("utf-8"))>256*1024: raise ValueError("OUTPUT_LIMIT")
        delta=visible.push(delta)
        if delta:
            result+=delta
            if first is None and delta.strip():first=time.perf_counter()-started
            send({"v":1,"id":request["id"],"kind":"delta","seq":sequence,"text":delta});sequence+=1
    visible.finish()
    if finish not in ("stop", "length"): raise ValueError("INFERENCE_FAILED")
    return {"content":result,"finishReason":finish,"promptTokens":len(tokens),
            "completionTokens":len(MODEL.tokenize(raw_result.encode("utf-8"),add_bos=False)),
            "seconds":time.perf_counter()-started,"firstTextSeconds":first}

def main():
    while True:
        try:
            size=struct.unpack("<I",exact(4))[0]
            if not 0<size<=MAX_FRAME:return
            request=json.loads(exact(size).decode("utf-8"))
            if not isinstance(request,dict) or not isinstance(request.get("id"),str) or len(request["id"])>80:return
        except (EOFError,ValueError,KeyError,TypeError):
            return
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result=infer(request)
            send({"v":1,"id":request["id"],"kind":"result",**result})
        except Exception as error:
            code=str(error) if isinstance(error,ValueError) and str(error) in ("INPUT_INVALID","OUTPUT_BUDGET","CONTEXT_LIMIT","OUTPUT_LIMIT","REASONING_INCOMPLETE") else "INFERENCE_FAILED"
            send({"v":1,"id":request["id"],"kind":"error","code":code})
if __name__=="__main__":
    main()

