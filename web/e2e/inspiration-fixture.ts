type Message={role:string;content?:string}
type Body={messages:Message[];tools?:Array<{function:{name:string}}>}
/** Synthetic provider output only; production routes, meter and storage stay real. */
export function inspirationFixture(body:Body):Response|null{
  const instruction=String([...body.messages].reverse().find(m=>m.role==='user')?.content??'');let message:unknown
  if(instruction.includes('只返回JSON')){
    const input=JSON.parse(instruction.split('\n').at(-1)!)
    const evidence=Array.isArray(input)?input.flatMap(c=>c.evidence).slice(0,2):[{segmentId:input.segmentId,quote:input.text.slice(0,30)}]
    message={role:'assistant',content:JSON.stringify({cards:[{title:'救援与记忆的代价',narrative:'修复师为救人舍弃记忆，获救者认得他，并用旧信帮助他查明自己的选择。',tags:['救援','代价'],characters:['修复师'],conflict:'救人需要舍弃记忆',choice:'救人',outcome:'忘记获救者',turn:'对方认得他',foreshadowing:'旧信',evidence}]})}
  }else if(instruction.includes('[灵感测试]')){
    const last=body.messages.length-1-[...body.messages].reverse().findIndex(m=>m.role==='user'),results=body.messages.slice(last+1).filter(m=>m.role==='tool'),value=results.length?JSON.parse(results.at(-1)!.content!).value:undefined
    const tool=(name:string,args:unknown)=>({id:`inspiration-${body.messages.length}`,type:'function',function:{name:body.tools!.find(t=>t.function.name.includes(`_${name}_`))!.function.name,arguments:JSON.stringify(args)}})
    message=!results.length?{role:'assistant',content:'检索私有灵感库。',tool_calls:[tool('search_inspiration_library',{query:'救援'})]}:results.length===1?{role:'assistant',content:'阅读情节与出处。',tool_calls:[tool('read_inspiration_card',{cardId:value.cards[0].id})]}:results.length===2?{role:'assistant',content:'提出本书改编。',tool_calls:[tool('save_inspiration_adaptation',{cardId:value.id,revision:value.revision,title:'主动舍弃旧信',content:'修复师为了保护证人烧掉身世线索，证人决定替他查明真相。',changes:'从被动失忆改为主动舍弃，并交换人物的选择与后续行动。'})]}:{role:'assistant',content:'附来源的改编候选已保存，等待作者核对。'}
  }else return null
  return new Response(JSON.stringify({choices:[{message,finish_reason:(message as {tool_calls?:unknown}).tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:50,completion_tokens:100}}),{headers:{'content-type':'application/json'}})
}
