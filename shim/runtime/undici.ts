export const fetch = (...a: any[]) => (globalThis.fetch as any)(...a); export class Agent {}; export class ProxyAgent {}; export const setGlobalDispatcher = () => {}; export default { fetch, Agent, ProxyAgent, setGlobalDispatcher }

export const getGlobalDispatcher = () => ({}); export const Dispatcher = class {}; export const Response = globalThis.Response; export const Request = globalThis.Request; export const Headers = globalThis.Headers; export const FormData = globalThis.FormData
export class EnvHttpProxyAgent {}; export class Pool {}; export class Client {}; export const interceptors = {}
