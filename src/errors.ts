export function safeError(error:unknown):string {
  const line=error instanceof Error?error.message.split('\n')[0]??'Request failed':'Request failed';
  return line.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s]+/gi,'[endpoint]').slice(0,220);
}
