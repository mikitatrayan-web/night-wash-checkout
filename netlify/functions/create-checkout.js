const Stripe = require("stripe");

const PRODUCT_BY_PLAN = {
  essential: "prod_U2TVadjFTRCnL3",
  elite: "prod_U2UOkYAFq7SC3m",
  comfort: "prod_U2UNC1ZrXU1sz8",
  signature: "prod_U2UQQUQPkgdpV5",
};

const priceCache = new Map();

async function getActivePriceId(stripe, productId) {
  if (priceCache.has(productId)) return priceCache.get(productId);

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
  const recurring = prices.data.find((p) => p.type === "recurring" && p.recurring);
  if (!recurring) throw new Error(`No active recurring price for product ${productId}`);

  priceCache.set(productId, recurring.id);
  return recurring.id;
}

// Stripe metadata: максимум 50 ключей, значения строками и до ~500 символов.
// Делаем "безопасное" приведение к строкам и обрезаем.
function md(val, max = 500) {
  const s = (val ?? "").toString();
  return s.length > max ? s.slice(0, max) : s;
}

exports.handler = async (event) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = event.body ? JSON.parse(event.body) : {};

    const plan = md(String(body.plan || "essential").toLowerCase(), 50);
    const productId = PRODUCT_BY_PLAN[plan];
    if (!productId) return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan" }) };

    const priceId = await getActivePriceId(stripe, productId);

    const metadata = {
      plan,
      user_id: md(body.user_id),
      order_id: md(body.order_id),

      car_make: md(body.car_make, 200),
      address: md(body.address, 300),
      parking_spot: md(body.parking_spot, 100),
      wash_datetime: md(body.wash_datetime, 50),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://night-wash.com/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://night-wash.com/cancel",

      // metadata на Session
      metadata,

      // metadata на Subscription (важно для дальнейших платежей/учёта)
      subscription_data: { metadata },

      // если хочешь, можно добавить customer_email, если будешь собирать email на странице
      // customer_email: md(body.email, 200),
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
