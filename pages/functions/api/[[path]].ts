interface FuncEnv {
  API: Fetcher; // Service Binding to the Worker
}

export const onRequest: PagesFunction<FuncEnv> = async (context) => {
  const url = new URL(context.request.url);
  const apiPath = url.pathname + url.search;
  return context.env.API.fetch(new URL(apiPath, "https://dummy").toString(), context.request);
};