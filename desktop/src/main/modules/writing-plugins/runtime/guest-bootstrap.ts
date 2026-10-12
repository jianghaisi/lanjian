import { pluginLimits } from '@lanjian/writing-plugin-contracts'

/** Executed ONLY in QuickJS, before external source. Closures capture pristine
 * intrinsics; neither the bridge function nor serialization helpers are globals. */
export const guestBootstrap = `((bridge) => {
  const parse = JSON.parse, stringify = JSON.stringify, freeze = Object.freeze;
  const descriptors = Object.getOwnPropertyDescriptors, symbols = Object.getOwnPropertySymbols;
  const prototype = Object.getPrototypeOf, entries = Object.entries, isArray = Array.isArray;
  const plain = Object.prototype, finite = Number.isFinite, apply = Reflect.apply;
  const SetClass = Set, ErrorClass = Error;
  const setHas = Function.prototype.call.bind(Set.prototype.has);
  const setAdd = Function.prototype.call.bind(Set.prototype.add);
  const setDelete = Function.prototype.call.bind(Set.prototype.delete);
  const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  function encode(value, limit) {
    let nodes = 0, bytes = 0;
    const active = new SetClass();
    function visit(v, depth) {
      if (++nodes > ${pluginLimits.valueNodes} || depth > ${pluginLimits.valueDepth}) throw new ErrorClass('Invalid JSON');
      if (v === null || typeof v === 'boolean') { bytes += 5; return; }
      if (typeof v === 'number') { if (!finite(v)) throw new ErrorClass('Invalid JSON'); bytes += 24; return; }
      if (typeof v === 'string') { bytes += v.length; if (bytes > limit) throw new ErrorClass('Large JSON'); return; }
      const array = isArray(v);
      if (!v || typeof v !== 'object' || !array && prototype(v) !== plain && prototype(v) !== null || setHas(active, v) || symbols(v).length) throw new ErrorClass('Invalid JSON');
      if (array && v.length > ${pluginLimits.valueNodes}) throw new ErrorClass('Large JSON');
      setAdd(active, v);
      let count = 0;
      for (const [key, d] of entries(descriptors(v))) {
        if (array && key === 'length') continue;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !own(d, 'value') || !d.enumerable || array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new ErrorClass('Invalid JSON');
        bytes += key.length + 3;
        if (bytes > limit) throw new ErrorClass('Large JSON');
        count++; visit(d.value, depth + 1);
      }
      if (array && count !== v.length) throw new ErrorClass('Invalid JSON');
      setDelete(active, v);
    }
    visit(value, 0);
    const text = stringify(value);
    if (text.length > limit) throw new ErrorClass('Large JSON');
    return text;
  }
  const call = (method) => async (input) => parse(await bridge(method, encode(input, ${pluginLimits.inputBytes})));
  const ctx = freeze({
    book: freeze({ read: call('book.read') }),
    model: freeze({ generate: call('model.generate') }),
    candidate: freeze({ prepare: call('candidate.prepare') }),
    interaction: freeze({ request: call('interaction.request') }),
    assets: freeze({ readText: call('assets.readText') })
  });
  return freeze({
    invoke: async (fn, toolId, input, continuation) => {
      const args = continuation ? [toolId, parse(continuation).checkpoint, parse(continuation).answer, ctx] : [toolId, parse(input), ctx];
      return await apply(fn, undefined, args);
    },
    encode: value => encode(value, ${pluginLimits.outputBytes})
  });
})`
