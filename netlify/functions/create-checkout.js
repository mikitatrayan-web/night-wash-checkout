const Stripe = require("stripe");

const PRODUCT_BY_PLAN = {
  essential: "prod_U3heEBBHRgO6Ck",
  elite: "prod_U3hfrYakKpECbI",
  comfort: "prod_U3hgtkFMxJYCEn",
  signature: "prod_U3hh9pgXE2XgLQ",
};

// mapping plan → subtype
const SUBTYPE_BY_PLAN = {
  essential: "ONE_WASH",
  comfort: "TWO_WASH",
  elite: "THREE_WASH",
  signature: "FOUR_WASH",
};

const priceCache = new Map();

async function getActiveRecurringPriceId(stripe, productId) {
  if (priceCache.has(productId)) return priceCache.get(productId);

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 10,
  });

  const recurring = prices.data.find(
    (p) => p.type === "recurring" && p.recurring
  );

  if (!recurring)
    throw new Error(`No active recurring price for product ${productId}`);

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

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-make-apikey": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error("Make webhook failed");
  }

  // ожидаем, что Make вернёт JSON с klickContactId
  const data = await resp.json();
  return data.klickContactId;
}

exports.handler = async (event) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = event.body ? JSON.parse(event.body) : {};

    const plan = md(String(body.plan || "essential").toLowerCase(), 50);
    const productId = PRODUCT_BY_PLAN[plan];
    const subType = SUBTYPE_BY_PLAN[plan];

    if (!productId)
      return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan" }) };

    // 1️⃣ Send to Make first
    const klickContactId = await callMakeWebhook({
      firstName: body.firstName,
      lastName: body.lastName,
      phoneNumber: body.phoneNumber,
      email: body.email,
      plate: body.plate,
      brand: body.brand,
      model: body.model,
      color: body.color,
      floorLevel: body.floorLevel,
      parkingSpot: body.parkingSpot,
      boxDeliveryAddress: body.boxDeliveryAddress,
    });

    if (!klickContactId)
      throw new Error("klickContactId not returned from Make");

    // 2️⃣ Get Stripe price
    const priceId = await getActiveRecurringPriceId(stripe, productId);

    // 3️⃣ Create Stripe session with required metadata
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url:
        "https://night-wash.com/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://night-wash.com/cancel",

      metadata: {
        klickContactId: md(klickContactId),
        plate: md(body.plate, 50),
        subType: subType,
      },

      subscription_data: {
        metadata: {
          klickContactId: md(klickContactId),
          plate: md(body.plate, 50),
          subType: subType,
        },
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
