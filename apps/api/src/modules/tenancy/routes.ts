import type { FastifyInstance } from 'fastify';

/** Public storefront configuration for the store resolved from the host. */
export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store', async (request) => {
    const { store } = request;
    return {
      store: {
        id: store.id,
        slug: store.slug,
        name: store.name,
        currency: store.currency,
        locale: store.locale,
        timezone: store.timezone,
        settings: store.publicSettings,
        brand: { slug: store.brand.slug, name: store.brand.name },
      },
    };
  });
}
