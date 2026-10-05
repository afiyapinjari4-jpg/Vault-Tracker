import os
import json
import base64
import re
import time
from datetime import date, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if not GEMINI_API_KEY:
    raise RuntimeError("Missing GEMINI_API_KEY in backend/.env file!")

genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="Vault-Tracker Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash",
    "gemini-flash-latest"
]

class ScanRequest(BaseModel):
    image_base64: str

class RecipeRequest(BaseModel):
    items: list[str]
    diet: Optional[str] = "Any"
    appliance: Optional[str] = "Any"

class LifecycleEvent(BaseModel):
    pantry_item_id: Optional[str] = None
    item_name: str
    event_type: str
    quantity: int = 1
    notes: Optional[str] = None

class ForecastRequest(BaseModel):
    inventory: list[dict]
    events: list[dict]

class GraphRequest(BaseModel):
    inventory: list[dict]
    history_pairings: list[dict] = []

class MemoryRequest(BaseModel):
    events: list[dict]
    inventory: list[dict]

class AutopsyRequest(BaseModel):
    waste_events: list[dict]

class SimulationRequest(BaseModel):
    inventory: list[dict]
    days: int = 7

FOOD_IMAGE_REGISTRY = {
    "pasta": "https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=80",
    "skillet": "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
    "fry": "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80",
    "stir": "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80",
    "soup": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80",
    "stew": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80",
    "salad": "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80",
    "curry": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=800&q=80",
    "rice": "https://images.unsplash.com/photo-1516714435131-44d6b64dc6a2?auto=format&fit=crop&w=800&q=80",
    "bowl": "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=800&q=80",
    "bake": "https://images.unsplash.com/photo-1574894709920-11b28e7367e3?auto=format&fit=crop&w=800&q=80",
    "roast": "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80",
    "pot": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80",
    "toast": "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80",
    "egg": "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80",
    "dairy": "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80",
    "yogurt": "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80"
}

FALLBACK_GALLERY = [
    "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=800&q=80"
]

CULINARY_PAIRINGS = {
    "milk": ["cheese", "bread", "spinach", "eggs", "curd", "pasta", "butter"],
    "cheese": ["bread", "milk", "pasta", "tomatoes", "eggs", "muffins"],
    "spinach": ["milk", "cheese", "eggs", "tomatoes", "garlic", "pasta"],
    "bread": ["milk", "cheese", "eggs", "curd", "butter", "chicken"],
    "chicken": ["rice", "tomatoes", "garlic", "onion", "spinach", "curd"],
    "rice": ["chicken", "curd", "tomatoes", "beans", "eggs", "spinach"],
    "curd": ["rice", "bread", "milk", "muffins", "cucumber"],
    "tomatoes": ["spinach", "cheese", "pasta", "chicken", "garlic", "rice"],
    "pasta": ["cheese", "tomatoes", "milk", "spinach", "garlic"],
    "eggs": ["bread", "cheese", "milk", "spinach", "rice", "tomatoes"]
}

def get_dynamic_food_photo(title: str, item_list: list[str]) -> str:
    search_text = f"{title.lower()} {' '.join(item_list).lower()}"
    for keyword, url in FOOD_IMAGE_REGISTRY.items():
        if keyword in search_text:
            return url
    index = abs(hash(title)) % len(FALLBACK_GALLERY)
    return FALLBACK_GALLERY[index]

def extract_image_bytes(image_data: str) -> tuple[bytes, str]:
    mime_type = "image/jpeg"
    if "," in image_data:
        header, image_data = image_data.split(",", 1)
        if "png" in header.lower():
            mime_type = "image/png"
        elif "webp" in header.lower():
            mime_type = "image/webp"

    missing_padding = len(image_data) % 4
    if missing_padding:
        image_data += "=" * (4 - missing_padding)

    return base64.b64decode(image_data), mime_type

def call_gemini_vision_cascade(prompt: str, raw_bytes: bytes, mime_type: str) -> str:
    last_exception = None
    for model_name in VALID_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                [prompt, {"mime_type": mime_type, "data": raw_bytes}],
                generation_config={"response_mime_type": "application/json"}
            )
            if response and response.text:
                return response.text.strip()
        except Exception as e:
            last_exception = e
            if "429" in str(e):
                time.sleep(1.5)
            continue

    raise HTTPException(
        status_code=429,
        detail=f"Rate limit reached across fallback models. Please wait 15-30 seconds and try again. ({last_exception})"
    )

def generate_algorithmic_recipes(items: list[str], diet: str, appliance: str) -> list[dict]:
    tool = appliance if appliance and appliance != "Any" else "Skillet"
    items_title = " & ".join([i.capitalize() for i in items[:2]])
    recipe1 = {
        "title": f"Zero-Waste {items_title} {tool} Hash",
        "category": "skillet",
        "used_items": items[:3],
        "prep_time": "15 mins",
        "ingredients": [f"1 portion {i}" for i in items] + ["1 tbsp Cooking Oil", "Pinch of salt and pepper", "1 clove Garlic (minced)"],
        "instructions": [
            f"Preheat your {tool.lower()} over medium heat for 2 minutes.",
            f"Sauté aromatic spices and add {items[0]} for 4 minutes until lightly browned.",
            f"Fold in remaining ingredients ({', '.join(items[1:]) if len(items) > 1 else 'seasoning'}) and simmer for 6 minutes until tender and cooked through.",
            "Plate immediately and serve warm."
        ]
    }
    recipe2 = {
        "title": f"Crispy {items[0].capitalize()} Warm Medley",
        "category": "bowl",
        "used_items": items,
        "prep_time": "12 mins",
        "ingredients": [f"Diced {i}" for i in items] + ["1 tbsp Olive Oil", "Herb seasoning mix"],
        "instructions": [
            f"Toss diced ingredients with olive oil and spices for 1 minute.",
            f"Transfer to {tool.lower()} and roast on medium-high for 8 minutes, stirring halfway.",
            "Rest for 2 minutes before serving."
        ]
    }
    for r in [recipe1, recipe2]:
        r["image_url"] = get_dynamic_food_photo(r["title"], r["used_items"])
    return [recipe1, recipe2]

@app.get("/api/available-models")
def list_available_models():
    try:
        available = [m.name for m in genai.list_models() if "generateContent" in m.supported_generation_methods]
        return {"models": available}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/scan")
async def scan_item(payload: ScanRequest):
    try:
        raw_bytes, mime_type = extract_image_bytes(payload.image_base64)
        prompt = f"""
        Analyze this grocery product, container, or expiry stamp photo.
        1. Identify the specific product/brand name.
        2. Read any printed expiration date. Convert formats like 'JUL 2026' to '2026-07-31' or '31.12.2026' to '2026-12-31'.
        3. If no printed date exists, project a realistic expiry date starting from today ({date.today().isoformat()}).
        Output ONLY JSON:
        {{"item_name": "string", "expiry_date": "YYYY-MM-DD"}}
        """
        raw_text = call_gemini_vision_cascade(prompt, raw_bytes, mime_type)
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        match = re.search(r"\{.*?\}", raw_text, re.DOTALL)
        parsed = json.loads(match.group(0)) if match else json.loads(raw_text)

        item_name = str(parsed.get("item_name") or "Pantry Item").strip()
        expiry_date = str(parsed.get("expiry_date") or "").strip()

        if not re.match(r"^\d{4}-\d{2}-\d{2}$", expiry_date):
            expiry_date = (date.today() + timedelta(days=14)).isoformat()

        return {"item_name": item_name, "expiry_date": expiry_date}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan Processing Error: {str(e)}")

@app.post("/api/scan-bulk")
async def scan_bulk(payload: ScanRequest):
    try:
        raw_bytes, mime_type = extract_image_bytes(payload.image_base64)
        prompt = f"""
        Analyze this supermarket printed receipt or kitchen shelf image.
        Extract EVERY individual grocery item purchased or visible on this specific receipt.
        For each item:
        1. 'item_name': Actual item name printed (e.g., 'Milk', 'Spinach', 'Eggs').
        2. 'expiry_date': Calculate a realistic expiry date strictly in YYYY-MM-DD format starting from today ({date.today().isoformat()}):
           - Fresh greens / leafy produce / milk: +5 to 7 days
           - Fresh vegetables / fruits: +7 to 10 days
           - Yogurt / cheese / eggs: +14 to 21 days
           - Grains / pasta / pantry / canned goods: +90 to 180 days
        3. 'quantity': integer (default 1)
        Return strictly valid JSON:
        {{
          "items": [
            {{"item_name": "Item Name", "expiry_date": "YYYY-MM-DD", "quantity": 1}}
          ]
        }}
        """
        raw_text = call_gemini_vision_cascade(prompt, raw_bytes, mime_type)
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_text)
        items = parsed.get("items", [])

        if not items:
            raise HTTPException(status_code=422, detail="No readable items found on receipt.")

        cleaned_items = []
        for itm in items:
            name = str(itm.get("item_name") or "").strip()
            exp = str(itm.get("expiry_date") or "").strip()
            qty = int(itm.get("quantity") or 1)
            if not name:
                continue
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", exp):
                exp = (date.today() + timedelta(days=7)).isoformat()
            cleaned_items.append({"item_name": name, "expiry_date": exp, "quantity": qty})

        return {"items": cleaned_items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Receipt Processing Error: {str(e)}")

@app.post("/api/recipe")
async def generate_recipe(payload: RecipeRequest):
    if not payload.items:
        return {"recipes": []}

    items = payload.items
    items_str = ", ".join(items)
    diet = payload.diet or "Any"
    appliance = payload.appliance or "Any"
    num_recipes = min(max(len(items), 2), 3)

    diet_instruction = f"Strictly comply with dietary restriction: {diet}." if diet != "Any" else ""
    appliance_instruction = f"The recipes must be prepared using a {appliance}." if appliance != "Any" else ""

    prompt = f"""
    You are an expert chef specializing in zero-waste cooking.
    The user has these ingredients expiring soon: {items_str}.
    {diet_instruction}
    {appliance_instruction}
    Generate {num_recipes} DIFFERENT recipes that prioritize using these expiring ingredients.
    Ensure cooking steps include specific duration markers (e.g. 'sauté for 4 minutes', 'simmer for 15 minutes').
    Output strictly a JSON object:
    {{
      "recipes": [
        {{
          "title": "Recipe Title",
          "category": "one word: soup, skillet, pasta, salad, curry, stir, bake, rice, or bowl",
          "used_items": ["item1"],
          "prep_time": "20 mins",
          "ingredients": ["1 cup item1", "2 tbsp oil"],
          "instructions": ["Step 1", "Step 2", "Step 3"]
        }}
      ]
    }}
    """

    for model_name in VALID_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            parsed = json.loads(response.text.strip())
            recipes = parsed.get("recipes", [])
            if recipes:
                for r in recipes:
                    category_hint = r.get("category", "")
                    lookup_title = f"{r.get('title', '')} {category_hint}"
                    r["image_url"] = get_dynamic_food_photo(lookup_title, r.get("used_items", items))
                return {"recipes": recipes}
        except Exception:
            continue

    fallback_recipes = generate_algorithmic_recipes(items, diet, appliance)
    return {"recipes": fallback_recipes}

# --- Feature 1: Food Life Tracker Endpoints ---
@app.post("/api/lifecycle/event")
async def record_lifecycle_event(payload: LifecycleEvent):
    return {
        "status": "success",
        "recorded_event": payload.dict(),
        "timestamp": date.today().isoformat()
    }

@app.post("/api/lifecycle/stats")
async def calculate_lifecycle_stats(events: list[dict]):
    history_by_item = {}
    for ev in events:
        name = ev.get("item_name", "").lower().strip()
        history_by_item.setdefault(name, []).append(ev)

    analytics = []
    for name, ev_list in history_by_item.items():
        purchased = [e for e in ev_list if e.get("event_type") == "PURCHASED"]
        finished = [e for e in ev_list if e.get("event_type") in ("FINISHED", "WASTED")]

        avg_days = None
        if purchased and finished:
            durations = []
            for p in purchased:
                p_date = date.fromisoformat(p.get("event_date")[:10])
                for f in finished:
                    f_date = date.fromisoformat(f.get("event_date")[:10])
                    diff = (f_date - p_date).days
                    if diff >= 0:
                        durations.append(diff)
            if durations:
                avg_days = round(sum(durations) / len(durations), 1)

        analytics.append({
            "item_name": name.capitalize(),
            "total_events": len(ev_list),
            "average_lifespan_days": avg_days,
            "consumption_insight": f"You usually finish {name.capitalize()} in ~{avg_days} days." if avg_days else "Tracking consumption velocity..."
        })

    return {"item_analytics": analytics}

# --- Feature 2 & 8: Future Fridge & "What NOT to Buy" Engine ---
@app.post("/api/forecast/depletion")
async def forecast_depletion(payload: ForecastRequest):
    today = date.today()
    item_events = {}

    for ev in payload.events:
        name = ev.get("item_name", "").lower().strip()
        if name:
            item_events.setdefault(name, []).append(ev)

    predictions = []
    what_not_to_buy = []

    for item in payload.inventory:
        name = item.get("item_name", "").lower().strip()
        current_qty = item.get("quantity", 1)
        history = item_events.get(name, [])

        usage_events = [
            e for e in history 
            if e.get("event_type") in ("USED", "FINISHED", "OPENED")
        ]

        if len(usage_events) >= 2:
            sorted_evs = sorted(usage_events, key=lambda x: x.get("event_date", ""))
            first_date_str = sorted_evs[0].get("event_date", "")[:10]
            last_date_str = sorted_evs[-1].get("event_date", "")[:10]
            
            d_first = date.fromisoformat(first_date_str)
            d_last = date.fromisoformat(last_date_str)
            day_span = max((d_last - d_first).days, 1)

            total_consumed = sum(e.get("quantity", 1) for e in sorted_evs)
            daily_burn = total_consumed / day_span

            if daily_burn > 0:
                days_left = max(int(current_qty / daily_burn), 1)
                depletion_date = today + timedelta(days=days_left)
                confidence = min(55 + (len(usage_events) * 8), 95)
                rec_purchase = max(int(daily_burn * 7), 1)

                predictions.append({
                    "item_name": item.get("item_name"),
                    "current_qty": current_qty,
                    "days_left": days_left,
                    "depletion_date": depletion_date.isoformat(),
                    "confidence": confidence,
                    "recommended_purchase": rec_purchase,
                    "has_history": True
                })

                # Feature 8: "What NOT to Buy" determination
                if days_left >= 10:
                    status = "DON'T BUY" if days_left >= 14 else "WAIT"
                    what_not_to_buy.append({
                        "item_name": item.get("item_name"),
                        "current_qty": current_qty,
                        "days_covered": days_left,
                        "status": status,
                        "reason": f"Stock lasts {days_left} more days based on current burn rate ({round(daily_burn, 2)} units/day)."
                    })
                continue

        predictions.append({
            "item_name": item.get("item_name"),
            "current_qty": current_qty,
            "days_left": None,
            "depletion_date": None,
            "confidence": 0,
            "recommended_purchase": 1,
            "has_history": False
        })

    active_predictions = sorted(
        [p for p in predictions if p["has_history"]], 
        key=lambda x: x["days_left"]
    )
    unpredicted = [p for p in predictions if not p["has_history"]]

    return {
        "next_7_days": [p for p in active_predictions if p["days_left"] <= 7],
        "all_predictions": active_predictions,
        "unpredicted": unpredicted,
        "what_not_to_buy": what_not_to_buy
    }

# --- Feature 4: Ingredient Relationship Graph Engine ---
@app.post("/api/graph/relationships")
async def build_ingredient_graph(payload: GraphRequest):
    inventory_items = [i.get("item_name", "").strip() for i in payload.inventory if i.get("item_name")]
    inv_lookup = {i.lower(): i for i in inventory_items}
    nodes = []
    edges = []
    co_occurrences = {}

    for item in payload.inventory:
        name = item.get("item_name", "").strip()
        nodes.append({
            "id": name,
            "quantity": item.get("quantity", 1),
            "expiry_date": item.get("expiry_date", "")
        })

    for rec in payload.history_pairings:
        paired = [p.lower().strip() for p in rec.get("paired_items", []) if p.lower().strip() in inv_lookup]
        for idx1 in range(len(paired)):
            for idx2 in range(idx1 + 1, len(paired)):
                key = tuple(sorted([paired[idx1], paired[idx2]]))
                co_occurrences[key] = co_occurrences.get(key, 0) + 1

    active_lowers = list(inv_lookup.keys())
    for idx1 in range(len(active_lowers)):
        a = active_lowers[idx1]
        for idx2 in range(idx1 + 1, len(active_lowers)):
            b = active_lowers[idx2]
            key = tuple(sorted([a, b]))
            if b in CULINARY_PAIRINGS.get(a, []) or a in CULINARY_PAIRINGS.get(b, []):
                co_occurrences[key] = co_occurrences.get(key, 0) + 1

    connected_names = set()
    for (src, tgt), strength in co_occurrences.items():
        src_name = inv_lookup[src]
        tgt_name = inv_lookup[tgt]
        edges.append({
            "source": src_name,
            "target": tgt_name,
            "strength": strength
        })
        connected_names.add(src_name)
        connected_names.add(tgt_name)

    meal_synergy_msg = f"You currently have {len(connected_names)} ingredients that form strong meal combinations." if len(connected_names) >= 2 else "Add more ingredients to reveal meal pairing combinations."

    return {
        "nodes": nodes,
        "edges": edges,
        "synergy_message": meal_synergy_msg,
        "connected_count": len(connected_names)
    }

# --- Feature 5: Kitchen Memory ---
@app.post("/api/kitchen-memory")
async def analyze_kitchen_memory(payload: MemoryRequest):
    purchases = {}
    consumed = {}
    wasted = {}

    for ev in payload.events:
        name = ev.get("item_name", "").lower().strip()
        ev_type = ev.get("event_type", "")
        qty = ev.get("quantity", 1)

        if ev_type == "PURCHASED":
            purchases[name] = purchases.get(name, 0) + qty
        elif ev_type in ("USED", "FINISHED"):
            consumed[name] = consumed.get(name, 0) + qty
        elif ev_type == "WASTED":
            wasted[name] = wasted.get(name, 0) + qty

    habits = []
    recommendations = []

    for item, bought_qty in purchases.items():
        used_qty = consumed.get(item, 0)
        lost_qty = wasted.get(item, 0)

        if bought_qty >= 3 and used_qty < (bought_qty / 2):
            recommendations.append({
                "item": item.capitalize(),
                "pattern": f"Purchased {bought_qty} times, but only consumed {used_qty} before expiration.",
                "action": f"Consider buying {max(int(used_qty), 1)} pack(s) instead of {bought_qty} next time."
            })

        habits.append({
            "item_name": item.capitalize(),
            "purchased_count": bought_qty,
            "consumed_count": used_qty,
            "wasted_count": lost_qty,
            "consumption_ratio": f"{int((used_qty / bought_qty) * 100)}%" if bought_qty > 0 else "0%"
        })

    habits = sorted(habits, key=lambda x: x["purchased_count"], reverse=True)

    gemini_insight = None
    if purchases:
        prompt = f"""
        You are a culinary habit analyst.
        Review this household kitchen history:
        Purchases: {purchases}
        Consumed: {consumed}
        Wasted: {wasted}

        Provide 2 concise behavioral insights and 1 shopping optimization tip.
        Output strictly JSON:
        {{
          "primary_habit": "string",
          "actionable_tip": "string"
        }}
        """
        for model_name in VALID_MODELS:
            try:
                model = genai.GenerativeModel(model_name)
                res = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                parsed = json.loads(res.text.strip())
                gemini_insight = parsed
                break
            except Exception:
                continue

    if not gemini_insight:
        gemini_insight = {
            "primary_habit": "Perishable produce shows high reorder frequency.",
            "actionable_tip": "Keep delicate items on top shelf to prevent forgotten waste."
        }

    return {
        "habits": habits,
        "recommendations": recommendations,
        "ai_insight": gemini_insight
    }

# --- Feature 6 & 8: Waste Autopsy & True Food Cost ---
@app.post("/api/waste-autopsy")
async def analyze_waste_autopsy(payload: AutopsyRequest):
    reasons = {}
    total_cost = 0.0
    total_items = 0

    for w in payload.waste_events:
        r = w.get("reason", "Other")
        c = float(w.get("estimated_cost", 50.0))
        q = int(w.get("quantity", 1))

        reasons[r] = reasons.get(r, 0) + q
        total_cost += (c * q)
        total_items += q

    percentages = {}
    if total_items > 0:
        for r, cnt in reasons.items():
            percentages[r] = round((cnt / total_items) * 100, 1)

    annual_projection = round(total_cost * 12, 2)

    prompt = f"""
    Analyze these food waste autopsy reasons:
    {json.dumps(percentages)}
    Total Money Lost: ₹{total_cost}
    
    Give 2 actionable preventive steps to stop this specific waste reason.
    Return JSON ONLY:
    {{
      "primary_cause": "string",
      "curative_action": "string"
    }}
    """
    ai_feedback = None
    for model_name in VALID_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            res = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            ai_feedback = json.loads(res.text.strip())
            break
        except Exception:
            continue

    if not ai_feedback:
        ai_feedback = {
            "primary_cause": "Items forgotten or bought in excess.",
            "curative_action": "Organize priority cooking shelf for items with <48h remaining."
        }

    return {
        "total_wasted_items": total_items,
        "total_cost_lost": round(total_cost, 2),
        "annual_projected_loss": annual_projection,
        "reason_percentages": percentages,
        "ai_autopsy": ai_feedback
    }

# --- Feature 10: Future Kitchen 7-Day & 30-Day Simulation ---
@app.post("/api/simulate-kitchen")
async def simulate_future_kitchen(payload: SimulationRequest):
    days = payload.days
    today = date.today()
    cutoff = today + timedelta(days=days)

    at_risk = []
    projected_depleted = []

    for item in payload.inventory:
        try:
            exp = date.fromisoformat(item.get("expiry_date", today.isoformat()))
            if exp <= cutoff:
                at_risk.append(item.get("item_name"))
        except Exception:
            pass
        if int(item.get("quantity", 1)) <= 1:
            projected_depleted.append(item.get("item_name"))

    projected_remaining = max(len(payload.inventory) - len(at_risk), 0)

    return {
        "days": days,
        "projected_remaining": projected_remaining,
        "at_risk_expiry": at_risk,
        "depleted_items": projected_depleted,
        "projected_waste_events": len(at_risk),
        "potential_rescue_meals": max(len(at_risk) // 2, 1)
    }

@app.get("/")
def root():
    return {"status": "Vault-Tracker backend operational"}