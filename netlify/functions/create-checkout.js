const Stripe = require("stripe");

const PRODUCT_BY_PLAN = {
  essential: "prod_U2TVadjFTRCnL3",
  elite: "prod_U2UOkYAFq7SC3m",
  comfort: "prod_U2UNC1ZrXU1sz8",
  signature: "prod_U2UQQUQPkgdpV5",
};

// небольшая память-кэш, чтобы не дергать Stripe каждый раз
const priceCache = new Map();

async function getActivePriceId(stripe, productId) {
  if (priceCache.has(productId)) return priceCache.get(productId);

  // Для подписки ищем recurring price (например monthly)
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 10,
  });

  // Выбираем первую recurring цену (если подписка)
  const recurring = prices.data.find((p) => p.type === "recurring" && p.recurring);
  const oneTime = prices.data.find((p) => p.type === "one_time");

  const chosen = recurring || oneTime;
  if (!chosen) throw new Error(`No active prices found for product ${productId}`);

  priceCache.set(productId, chosen.id);
  return chosen.id;
}

exports.handler = async (event) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = event.body ? JSON.parse(event.body) : {};
    const plan = String(body.plan || "essential").toLowerCase();
    const user_id = body.user_id || "";
    const order_id = body.order_id || "";

    const productId = PRODUCT_BY_PLAN[plan];
    if (!productId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan" }) };
    }

    const priceId = await getActivePriceId(stripe, productId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription", // если у тебя подписка
      line_items: [{ price: priceId, quantity: 1 }],

      success_url: "https://night-wash.com/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://night-wash.com/cancel",

      metadata: { plan, user_id: String(user_id), order_id: String(order_id) },

      subscription_data: {
        metadata: { plan, user_id: String(user_id), order_id: String(order_id) },
      },
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
