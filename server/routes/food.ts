import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { langOf, UserError } from '../i18n.ts';
import { copyEntries, deleteEntry, getDay, moveEntries, putEntry } from '../services/diary.ts';
import { today } from '../services/days.ts';
import { addMeal, listMeals, updateMeal } from '../services/meals.ts';
import { createSavedMeal, deleteSavedMeal, listSavedMeals, updateSavedMeal } from '../services/savedMeals.ts';
import {
  createProduct,
  deleteProduct,
  getProduct,
  lookupBarcode,
  productLists,
  searchProducts,
  searchOnline,
  setPreference,
  updateProduct,
} from '../services/products.ts';
import { getRecipe, saveRecipe } from '../services/recipes.ts';
import { getProfile, timeZoneOf } from '../services/profile.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });

async function context() {
  const profile = await getProfile();
  return { lang: langOf(profile), today: today(timeZoneOf(profile)) };
}

/** Products, meals and the diary. */
export async function foodRoutes(app: FastifyInstance) {
  // ---------- Products ----------

  // Local search; with online=1 the query also goes to Open Food Facts (only when you ask: OFF's search limit is low).
  app.get('/api/products/search', async (req) => {
    const { q, online } = z.object({ q: z.string().max(120).default(''), online: z.enum(['0', '1']).default('0') }).parse(req.query);
    const { lang, today } = await context();
    return { products: online === '1' ? await searchOnline(q, lang) : await searchProducts(q, lang, today) };
  });

  app.get('/api/products/lists', async () => {
    const { lang, today } = await context();
    return productLists(lang, today);
  });

  app.get('/api/products/barcode/:code', async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.params);
    return { product: await lookupBarcode(code, (await context()).lang) };
  });

  app.get('/api/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const product = await getProduct(id, (await context()).lang);
    if (!product) throw new UserError(404, 'Product not found', 'Product niet gevonden');
    return { product };
  });

  app.post('/api/products', async (req) => ({ product: await createProduct(req.body, (await context()).lang) }));

  // Your own product changes in place; an OFF/NEVO product gets (or updates) a local edit.
  app.put('/api/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return { product: await updateProduct(id, req.body, (await context()).lang) };
  });

  app.delete('/api/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    await deleteProduct(id);
    return { ok: true };
  });

  app.put('/api/products/:id/preference', async (req) => {
    const { id } = idParam.parse(req.params);
    const { preference } = z.object({ preference: z.enum(['favorite', 'hidden']).nullable() }).strict().parse(req.body);
    await setPreference(id, preference);
    return { product: await getProduct(id, (await context()).lang) };
  });

  // ---------- Recipes (a recipe is a product; delete it like one) ----------

  app.get('/api/recipes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return { recipe: await getRecipe(id, (await context()).lang) };
  });
  app.post('/api/recipes', async (req) => ({ recipe: await saveRecipe(null, req.body, (await context()).lang) }));
  app.put('/api/recipes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return { recipe: await saveRecipe(id, req.body, (await context()).lang) };
  });

  // ---------- Meals ----------

  app.get('/api/meals', async () => ({ meals: await listMeals((await context()).lang) }));
  app.post('/api/meals', async (req) => ({ meals: await addMeal(req.body, (await context()).lang) }));
  app.put('/api/meals/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return { meals: await updateMeal(id, req.body, (await context()).lang) };
  });

  // ---------- Saved meals ----------

  app.get('/api/saved-meals', async () => ({ savedMeals: await listSavedMeals((await context()).lang) }));
  app.post('/api/saved-meals', async (req) => createSavedMeal(req.body, (await context()).lang));
  app.put('/api/saved-meals/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return updateSavedMeal(id, req.body, (await context()).lang);
  });
  app.delete('/api/saved-meals/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    await deleteSavedMeal(id);
    return { ok: true };
  });

  // ---------- Diary ----------

  app.get('/api/diary/:day', async (req) => {
    const { day } = z.object({ day: z.string() }).parse(req.params);
    return getDay(day, (await context()).lang);
  });

  // PUT by an id the app made: the offline queue can send it again without logging twice.
  app.put('/api/diary/entries/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return { entry: await putEntry(id, req.body, (await context()).lang) };
  });

  app.delete('/api/diary/entries/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deleteEntry(id);
    return { ok: true };
  });

  app.post('/api/diary/copy', async (req) => copyEntries(req.body, (await context()).lang));
  app.post('/api/diary/move', async (req) => moveEntries(req.body));
}
