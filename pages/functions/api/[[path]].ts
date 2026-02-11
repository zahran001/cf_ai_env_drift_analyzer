export const onRequest: PagesFunction<{ API: Fetcher }> = async (context) => {
  // Pass the exact original request directly to the backend Worker
  return context.env.API.fetch(context.request.clone() as unknown as Request);
};