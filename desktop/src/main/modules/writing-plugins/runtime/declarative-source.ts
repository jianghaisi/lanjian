import { validatePluginRecipe, type PluginManifest } from '@lanjian/writing-plugin-contracts'

/** Only this trusted interpreter is executable. Recipe text is JSON inside a
 * quoted string, never a JS expression. It runs in the SAME isolated guest. */
export function declarativeSource(text: string, manifest: PluginManifest): string {
  const recipe = validatePluginRecipe(JSON.parse(text), manifest)
  return `const recipe = JSON.parse(${JSON.stringify(JSON.stringify(recipe))});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function resolve(value, state) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => resolve(v,state));
  if (own(value,'$ref')) {
    let found = { input: state.input, steps: state.values };
    for (const part of value.$ref.split('.')) {
      if (!found || typeof found !== 'object' || !own(found,part)) throw Error('Missing recipe value');
      found = found[part];
    }
    return found;
  }
  if (own(value,'$join')) return value.$join.map(v => {
    const found = resolve(v,state); return typeof found === 'string' ? found : JSON.stringify(found);
  }).join('');
  const result = {};
  for (const [key,v] of Object.entries(value)) result[key] = resolve(v,state);
  return result;
}
function tool(id) { const value=recipe.tools.find(t=>t.id===id); if(!value) throw Error('Unknown recipe tool'); return value; }
async function run(t,state,ctx) {
  for(let i=state.next;i<t.steps.length;i++) {
    const step=t.steps[i];
    if(step.when) {
      const [a,b]=resolve(step.when.equals,state);
      if(a !== null && typeof a==='object' || b !== null && typeof b==='object') throw Error('Condition requires scalar values');
      if(a!==b) { state.values[step.id]=null; continue; }
    }
    const args=resolve(step.args,state);
    if(step.call==='interaction.request') {
      await ctx.interaction.request({question:args.question,checkpoint:{format:1,toolId:t.id,next:i+1,input:state.input,values:state.values}});
      return {};
    }
    const [group,method]=step.call.split('.');
    state.values[step.id]=await ctx[group][method](args);
  }
  return resolve(t.result,state);
}
export async function execute(id,input,ctx) { return run(tool(id),{next:0,input,values:{}},ctx); }
export async function resume(id,checkpoint,answer,ctx) {
  const t=tool(id), c=checkpoint;
  if(!c || c.format!==1 || c.toolId!==id || !Number.isInteger(c.next) || c.next<1 || c.next>t.steps.length || t.steps[c.next-1].call!=='interaction.request' || !c.values || Array.isArray(c.values)) throw Error('Invalid recipe checkpoint');
  c.values[t.steps[c.next-1].id]=answer;
  return run(t,c,ctx);
}`
}
