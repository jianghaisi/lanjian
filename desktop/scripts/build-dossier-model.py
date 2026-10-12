"""Original Lanjian dossier. Run with Blender --background --python this_file.
Scene uses X horizontal, Y vertical, Z toward the camera; export_yup=False
preserves the renderer assembly coordinates. No reference meshes/textures.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name,color,metal=0,rough=.3):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
plate=material('Chassis',(.73,.76,.7),.45,.33)
metal=material('BrushedMetal',(.66,.72,.68),.9,.22)
inset=material('Inset',(.12,.18,.15),.35,.38)
signal=material('Signal',(.68,.53,.28),.65,.22)
glass=material('OpticalGlass',(.8,.9,.84),.05,.14)
glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.12
face=material('ArchiveFace',(.12,.2,.16),0,.7)

def group(name):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o
back,core,cover=[group(n) for n in ['DossierBack','DossierCore','DossierCover']]

def finish(o,name,mat,parent,bevel=.015):
    o.name=name;o.data.materials.append(mat);o.parent=parent
    if bevel:
        mod=o.modifiers.new('Machined radius','BEVEL');mod.width=bevel;mod.segments=3
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def box(name,size,loc,mat,parent,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,parent,bevel)

def chamfer(name,w,h,d,z,mat,parent):
    x,y=w/2,h/2;b=.17
    outline=[(-x,-y),(x-b,-y),(x,-y+b),(x,y-b),(x-b,y),(-x,y)]
    verts=[(a,b,z+c) for c in [-d/2,d/2] for a,b in outline];n=len(outline)
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    return finish(o,name,mat,parent,.025)

chamfer('Back alloy enclosure',6.4,3.6,.18,-.12,plate,back)
chamfer('Core cassette',6.28,3.48,.06,0,metal,core)
# The front label is a UV plane replaced by the actual project summary at runtime.
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.085));label=bpy.context.object;label.scale=(3.105,1.705,1)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(label,'Project summary display',face,cover,0)
chamfer('Optical cover',6.27,3.47,.018,.106,glass,cover)
for y in [-1.75,1.75]:box('Brushed edge rail',(6.32,.038,.05),(0,y,.13),metal,cover,.01)
for x in [-3.15,3.15]:box('Light pipe',(.038,3.52,.05),(x,0,.13),signal,cover,.01)
box('Spine registration',(.055,3.26,.08),(-3.09,0,.035),signal,back,.01)
for i in range(5):box('Internal lamination '+str(i),(6.1,3.32,.007),(0,0,-.045+i*.018),inset if i%2 else metal,core,.002)
for i in range(18):box('Gold contact '+str(i),(.045,.13,.03),(-2.1+i*.13,-1.7,.025),signal,core,.005)
for x in [-3.1,3.08]:
    for y in [-1.7,1.7]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.046,depth=.042,location=(x,y,.15));finish(bpy.context.object,'Recessed fastener',metal,cover,.006)
        box('Fastener slot',(.051,.009,.004),(x,y,.174),inset,cover,.002)
# Machining grooves and a stepped connector at the bottom are visible in macro.
for i in range(3):box('Spine machining groove',(.012,2.9,.012),(-3.17+i*.028,0,-.018),inset,back,.003)
for x in [-2.8,2.8]:box('Retention latch',(.23,.18,.09),(x,-1.72,-.05),metal,core,.018)

# Match the wide continue-writing card without changing layer origins.
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        o.location.x*=7.2/6.4;o.location.y*=3.4/3.6
        for v in o.data.vertices:v.co.x*=7.2/6.4;v.co.y*=3.4/3.6
# Source studio only. Export meshes/assembly empties explicitly, excluding lights.
for o in bpy.context.scene.objects:o.select_set(o.type in {'MESH','EMPTY'})
assets=ROOT/'public'/'boot';assets.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(assets/'lanjian-dossier.glb'),export_format='GLB',use_selection=True,export_yup=False,export_apply=True)
for name,loc,power,size in [('Key',(-5,7,8),1100,7),('Rim',(5,4,-4),1700,5)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(7,5,12));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=52;bpy.context.scene.camera=cam
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=32
bpy.context.scene.world=bpy.data.worlds.new('Dossier studio')
bpy.context.scene.world.color=(.15,.15,.15)
bpy.context.scene.render.resolution_x=1440;bpy.context.scene.render.resolution_y=900;bpy.context.scene.render.resolution_percentage=100
source=ROOT/'art';source.mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(source/'lanjian-dossier.blend'))
print('LANJIAN_DOSSIER_EXPORTED',assets/'lanjian-dossier.glb')
