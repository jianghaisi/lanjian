"""Prepare selected transparent pet videos; retain source files and provenance.

Developer-only: uses the existing local inspection tools, never product runtime.
No repaint/inpainting: remove only detached background outside the character.
"""
from pathlib import Path
import argparse, hashlib, json, subprocess, sys
import numpy as np
from PIL import Image

desktop=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(desktop/'artifacts/pet-analysis-deps'))
import cv2
sys.path.insert(0,str(Path.home()/'AppData/Local/Temp/pet-video-inspection-tools'))
import imageio_ffmpeg
cv2.setNumThreads(2)
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True)
p.add_argument('--output',type=Path,default=desktop/'src/renderer/assets/visuals/pet-videos')
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
catalog=json.loads((a.source/'catalog.json').read_text(encoding='utf-8'))
selected=[row for row in catalog['actions'] if row['status']=='candidate_ready']
assert len(selected)==17 and 'handshake' not in {row['id'] for row in selected}
manifest={}
for row in selected:
    source=a.source/row['candidate_file']['name'];source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    assert source_hash==row['candidate_file']['sha256']
    output=a.output/(row['id']+'.webm')
    reader=imageio_ffmpeg.read_frames(str(source),pix_fmt='rgba',bits_per_pixel=32,input_params=['-c:v','libvpx-vp9'])
    meta=next(reader);assert meta['size']==(960,960) and meta['fps']==24
    proc=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error','-n','-f','rawvideo','-pix_fmt','rgba','-s','960x960','-r','24','-i','-','-an','-c:v','libvpx-vp9','-b:v','0','-crf','18','-deadline','good','-cpu-used','3','-row-mt','1','-threads','2','-auto-alt-ref','0','-pix_fmt','yuva420p','-metadata:s:v:0','alpha_mode=1',str(output)],stdin=subprocess.PIPE)
    frames=0;removed=0
    try:
        for raw in reader:
            frame=np.frombuffer(raw,np.uint8).reshape(960,960,4).copy()
            mask=cv2.dilate(np.uint8(frame[...,3]>24),np.ones((9,9),np.uint8))
            count,labels,stats,_=cv2.connectedComponentsWithStats(mask)
            body=1+stats[1:,4].argmax();outside=labels!=body
            removed=max(removed,int(((frame[...,3]>24)&outside).sum()))
            frame[outside,3]=0
            if row['id']=='idle' and frames==0:Image.fromarray(frame).save(a.output/'poster.png')
            proc.stdin.write(frame.tobytes());frames+=1
    finally:reader.close();proc.stdin.close()
    assert proc.wait()==0
    expected=json.loads((a.source/(row['id']+'-edge-v2-processing.json')).read_text(encoding='utf-8'))['frames']
    assert frames==expected
    manifest[row['id']]={'file':output.name,'fps':24,'frames':frames,'durationMs':frames/24*1000,'loop':'循环' in row['playback'],'size':[960,960],'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'source':source.name,'sourceSha256':source_hash,'provider':row.get('source_kind','Dola'),'maxDetachedPixelsRemoved':removed}
    print(json.dumps({'id':row['id'],'frames':frames,'bytes':output.stat().st_size,'detachedPixelsRemoved':removed}),flush=True)
(a.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'clips':len(manifest),'bytes':sum(row['bytes'] for row in manifest.values())}))
