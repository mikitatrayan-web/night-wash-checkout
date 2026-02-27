const Stripe = require("stripe");

const PRODUCT_BY_PLAN = {
  essential: "prod_U3heEBBHRgO6Ck",
  elite: "prod_U3hfrYakKpECbI",
  comfort: "prod_U3hgtkFMxJYCEn",
  signature: "prod_U3hh9pgXE2XgLQ",
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

function md(val, max = 500) {
  const s = (val ?? "").toString().trim();
  return s.length > max ? s.slice(0, max) : s;
}

async function callMakeWebhook(payload) {
  const url = process.env.MAKE_WEBHOOK_URL;
  const apiKey = process.env.MAKE_API_KEY;

  if (!url) throw new Error("MAKE_WEBHOOK_URL is not set");
  if (!apiKey) throw new Error("MAKE_API_KEY is not set");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-make-apikey": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Make webhook failed: ${resp.status} ${resp.statusText} ${text}`.slice(0, 800));
  }
}

exports.handler = async (event) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = event.body ? JSON.parse(event.body) : {};
    const plan = md(String(body.plan || "essential").toLowerCase(), 50);

    const productId = PRODUCT_BY_PLAN[plan];
    if (!productId) return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan" }) };

    // Данные клиента (для Make)
    const makePayload = {
      firstName: md(body.firstName, 80),
      lastName: md(body.lastName, 80),
      phoneNumber: md(body.phoneNumber, 40),
      email: md(body.email, 200),

      plate: md(body.plate, 50),
      brand: md(body.brand, 80),
      model: md(body.model, 80),
      color: md(body.color, 50),
      floorLevel: md(body.floorLevel, 50),
      parkingSpot: md(body.parkingSpot, 50),
      boxDeliveryAddress: md(body.boxDeliveryAddress, 300),

      plan,
      user_id: md(body.user_id, 200),
      order_id: md(body.order_id, 200),
    };

    // 1) СНАЧАЛА Make
    await callMakeWebhook(makePayload);

    // 2) ПОТОМ Stripe Checkout
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
      metadata,
      subscription_data: { metadata },
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
