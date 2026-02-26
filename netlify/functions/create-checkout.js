const Stripe = require("stripe");

const PRODUCT_BY_PLAN = {
  essential: "prod_U2TVadjFTRCnL3",
  elite: "prod_U2UOkYAFq7SC3m",
  comfort: "prod_U2UNC1ZrXU1sz8",
  signature: "prod_U2UQQUQPkgdpV5",
};

const priceCache = new Map();

async function getActiveRecurringPriceId(stripe, productId) {
  if (priceCache.has(productId)) return priceCache.get(productId);

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
  const recurring = prices.data.find((p) => p.type === "recurring" && p.recurring);

  if (!recurring) throw new Error(`No active recurring price for product ${productId}`);

  priceCache.set(productId, recurring.id);
  return recurring.id;
}

// Stripe metadata values must be strings, max ~500 chars.
// Keep keys <= 40 chars. Up to 50 keys.
function md(val, max = 500) {
  const s = (val ?? "").toString().trim();
  return s.length > max ? s.slice(0, max) : s;
}

exports.handler = async (event) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = event.body ? JSON.parse(event.body) : {};

    const plan = md(String(body.plan || "essential").toLowerCase(), 50);
    const productId = PRODUCT_BY_PLAN[plan];
    if (!productId) return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan" }) };

    const priceId = await getActiveRecurringPriceId(stripe, productId);

    const metadata = {
      plan,
      user_id: md(body.user_id, 200),
      order_id: md(body.order_id, 200),

      plate: md(body.plate, 50),
      brand: md(body.brand, 80),
      model: md(body.model, 80),
      color: md(body.color, 50),
      floorLevel: md(body.floorLevel, 50),
      parkingSpot: md(body.parkingSpot, 50),
      boxDeliveryAddress: md(body.boxDeliveryAddress, 300),

      privacyPolicyAccepted: "true",
      privacyPolicyUrl: "https://night-wash.com/terms2",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://night-wash.com/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://night-wash.com/cancel",

      // Session metadata
      metadata,

      // Subscription metadata (important for ongoing billing)
      subscription_data: { metadata },
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
