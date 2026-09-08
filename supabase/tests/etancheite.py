#!/usr/bin/env python3
"""Le banc d'étanchéité, contre la vraie API.

Les bancs SQL prouvent que les politiques sont justes. Ils ne prouvent pas
que la porte d'entrée est fermée : un test qui tourne dans psql saute
PostgREST, saute les droits de rôle, saute le jeton. Celui-ci se connecte
comme un vrai employé, avec un vrai mot de passe, et essaie de passer le mur
par les mêmes appels HTTP qu'un attaquant.

Deux murs à éprouver, et ils sont indépendants :
  1. Entre agences. Tunis Consulting ne doit rien voir de Sahara Voyages.
  2. Entre clients. Le porteur d'un lien de suivi ne voit que son dossier.

    source .sbenv && python3 supabase/tests/etancheite.py
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON_KEY"]
SERVICE = os.environ.get("SUPABASE_SERVICE_KEY", "")
PASSWORD = "VisaFlow!Demo2026"

verts, rouges = 0, []


def ok(condition, label, detail=""):
    global verts
    if condition:
        verts += 1
        print(f"  OK    {label}")
    else:
        rouges.append(f"{label} · {detail}")
        print(f"  ÉCHEC {label} · {detail}")


def http(path, method="GET", body=None, token=None, key=None):
    url = path if path.startswith("http") else f"{URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key or ANON)
    req.add_header("Authorization", f"Bearer {token or key or ANON}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "visaflow-tests/1.0")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def connexion(email):
    status, data = http("/auth/v1/token?grant_type=password", "POST",
                        {"email": email, "password": PASSWORD})
    if status != 200 or not data.get("access_token"):
        raise SystemExit(f"connexion impossible pour {email} : {status} {data}")
    return data["access_token"]


def charge_utile(jwt):
    """Le contenu du jeton, sans vérifier la signature : on regarde ce que le
    hook y a écrit, pas si le serveur a raison."""
    corps = jwt.split(".")[1]
    corps += "=" * (-len(corps) % 4)
    import base64
    return json.loads(base64.urlsafe_b64decode(corps))


def service(path, method="GET", body=None):
    return http(path, method, body, key=SERVICE)


print("Connexion des sept comptes de démonstration")
jetons = {
    "tca_owner":   connexion("slim@tunis-consulting.test"),
    "tca_manager": connexion("amira@tunis-consulting.test"),
    "tca_agent":   connexion("hatem@tunis-consulting.test"),
    "tca_tripoli": connexion("najat@tunis-consulting.test"),
    "tca_viewer":  connexion("stage@tunis-consulting.test"),
    "sah_owner":   connexion("rania@sahara-voyages.test"),
    "sah_agent":   connexion("anis@sahara-voyages.test"),
}
print(f"  {len(jetons)} comptes connectés\n")

# ---------------------------------------------------------------------
print("1 · Le jeton porte-t-il vraiment l'agence et le rôle ?")
# ---------------------------------------------------------------------
# Sans le hook, `auth_agency_id()` retombe sur une lecture de table à chaque
# requête. Ça marche, mais c'est lent et ça masque une erreur de configuration.
p = charge_utile(jetons["tca_agent"])
ok(p.get("agency_role") == "agent", "le jeton porte le rôle", p.get("agency_role"))
ok(bool(p.get("agency_id")), "le jeton porte l'agence")
ok(bool(p.get("office_id")), "le jeton porte le bureau")
p2 = charge_utile(jetons["sah_owner"])
ok(p.get("agency_id") != p2.get("agency_id"), "deux agences, deux identifiants dans le jeton")

# On récupère les identifiants réels par la clé de service, pour fabriquer des
# tentatives crédibles : un attaquant qui connaît un identifiant existe.
_, ags = service("/rest/v1/agencies?select=id,slug")
ids = {a["slug"]: a["id"] for a in ags}
_, sah_cases = service(f"/rest/v1/cases?agency_id=eq.{ids['sahara']}&select=id,reference,portal_token&limit=3")
_, tca_cases = service(f"/rest/v1/cases?agency_id=eq.{ids['tca']}&select=id,reference,portal_token,client_id&limit=3")
_, sah_clients = service(f"/rest/v1/clients?agency_id=eq.{ids['sahara']}&select=id,first_name&limit=2")

# ---------------------------------------------------------------------
print("\n2 · Le mur entre agences, en lecture")
# ---------------------------------------------------------------------
for role in ("tca_owner", "tca_manager", "tca_agent"):
    st, data = http(f"/rest/v1/cases?agency_id=eq.{ids['sahara']}&select=reference", token=jetons[role])
    ok(st == 200 and data == [], f"{role} ne lit aucun dossier de Sahara", f"{st} {str(data)[:80]}")

st, data = http("/rest/v1/clients?select=id", token=jetons["tca_owner"])
ok(st == 200 and len(data) == 24, "le propriétaire de TCA voit ses 24 clients, et seulement eux", f"{len(data or [])}")

st, data = http("/rest/v1/clients?select=id", token=jetons["sah_owner"])
ok(st == 200 and len(data) == 8, "le propriétaire de Sahara voit ses 8 clients, et seulement eux", f"{len(data or [])}")

# Le filtre est ignoré : on demande TOUT, sans condition. C'est la requête
# qu'un attaquant écrit en premier.
st, data = http("/rest/v1/cases?select=reference&limit=200", token=jetons["sah_agent"])
refs = {c["reference"][:2] for c in (data or [])}
ok(refs == {"SV"}, "une requête sans filtre ne rend que ses propres dossiers", str(refs))

# ---------------------------------------------------------------------
print("\n3 · Le mur entre agences, en écriture")
# ---------------------------------------------------------------------
cible = sah_cases[0]["id"]
st, data = http(f"/rest/v1/cases?id=eq.{cible}", "PATCH", {"stage": "clos"}, token=jetons["tca_owner"])
_, apres = service(f"/rest/v1/cases?id=eq.{cible}&select=stage")
ok(apres[0]["stage"] != "clos", "TCA ne modifie pas un dossier de Sahara", f"{st} {apres[0]['stage']}")

st, _ = http(f"/rest/v1/cases?id=eq.{cible}", "DELETE", token=jetons["tca_owner"])
_, reste = service(f"/rest/v1/cases?id=eq.{cible}&select=id")
ok(len(reste) == 1, "TCA ne supprime pas un dossier de Sahara", f"{st}")

# Insérer chez le voisin en mentant sur l'agence.
st, data = http("/rest/v1/clients", "POST",
                {"agency_id": ids["sahara"], "first_name": "Intrus", "last_name": "X", "phone": "+216 99 999 999"},
                token=jetons["tca_owner"])
ok(st >= 400, "TCA ne crée pas un client chez Sahara", f"{st} {str(data)[:90]}")

# ---------------------------------------------------------------------
print("\n4 · Les rôles à l'intérieur d'une même agence")
# ---------------------------------------------------------------------
st, data = http("/rest/v1/cases?select=reference&limit=1", token=jetons["tca_viewer"])
ok(st == 200 and len(data) == 1, "le lecteur lit", f"{st}")

st, data = http("/rest/v1/cases", "POST",
                {"agency_id": ids["tca"], "reference": "HACK-1",
                 "client_id": tca_cases[0]["client_id"], "visa_type_id": None},
                token=jetons["tca_viewer"])
ok(st >= 400, "le lecteur n'écrit pas", f"{st}")

st, data = http(f"/rest/v1/cases?id=eq.{tca_cases[0]['id']}", "PATCH", {"priority": "urgente"},
                token=jetons["tca_viewer"])
_, apres = service(f"/rest/v1/cases?id=eq.{tca_cases[0]['id']}&select=priority")
ok(apres[0]["priority"] != "urgente" or st >= 400, "le lecteur ne modifie pas", f"{st}")

# Le chiffre d'affaires : direction seulement. C'était une demande explicite.
st, data = http("/rest/v1/revenue_lines?select=amount&limit=5", token=jetons["tca_owner"])
vue_owner = st == 200 and isinstance(data, list)
st2, data2 = http("/rest/v1/revenue_lines?select=amount&limit=5", token=jetons["tca_agent"])
ok(vue_owner and (st2 >= 400 or data2 == []), "le revenu n'est visible que de la direction",
   f"owner {st}/{len(data or [])} · agent {st2}/{len(data2 or []) if isinstance(data2, list) else data2}")

# ---------------------------------------------------------------------
print("\n5 · Les fonctions métier, avec l'identifiant du voisin")
# ---------------------------------------------------------------------
st, data = http("/rest/v1/rpc/run_automations", "POST", {"p_agency": ids["sahara"]}, token=jetons["tca_owner"])
ok(st >= 400, "run_automations refuse l'agence d'un autre", f"{st} {str(data)[:80]}")

st, data = http("/rest/v1/rpc/record_decision", "POST",
                {"p_case": cible, "p_status": "refuse", "p_code": "autre"}, token=jetons["tca_owner"])
ok(st >= 400, "record_decision refuse un dossier d'un autre", f"{st} {str(data)[:80]}")

_, sah_q = service(f"/rest/v1/appointment_queue?agency_id=eq.{ids['sahara']}&select=id&limit=1")
if sah_q:
    st, data = http("/rest/v1/rpc/serve_queue", "POST",
                    {"p_entry": sah_q[0]["id"], "p_slot_at": "2026-12-01T09:00:00Z"}, token=jetons["tca_owner"])
    ok(st >= 400, "serve_queue refuse une file d'un autre", f"{st}")

st, data = http("/rest/v1/rpc/purge_expired", "POST", {"p_agency": ids["sahara"]}, token=jetons["tca_owner"])
ok(st >= 400, "purge_expired reste fermée, même au propriétaire", f"{st}")

# ---------------------------------------------------------------------
print("\n6 · Le mur entre clients, sans compte")
# ---------------------------------------------------------------------
jeton_a = tca_cases[0]["portal_token"]
jeton_b = tca_cases[1]["portal_token"]

st, data = http("/rest/v1/rpc/portal_case", "POST", {"p_token": jeton_a})
ok(st == 200 and data and data.get("case", {}).get("reference") == tca_cases[0]["reference"],
   "un lien de suivi ouvre le bon dossier", f"{st}")

ok(jeton_a != jeton_b and len(jeton_a) >= 32,
   "les jetons de suivi sont longs et distincts", f"{len(jeton_a)} caractères")

# La référence est séquentielle, donc devinable. Elle ne doit jamais ouvrir.
st, data = http("/rest/v1/rpc/portal_case", "POST", {"p_token": tca_cases[0]["reference"]})
ok(data in (None, [], {}), "une référence de dossier n'ouvre rien", f"{st} {str(data)[:60]}")

st, data = http("/rest/v1/rpc/portal_case", "POST", {"p_token": "0" * 64})
ok(data in (None, [], {}), "un jeton fabriqué n'ouvre rien", f"{st} {str(data)[:60]}")

# Le dossier rendu ne doit contenir aucune donnée d'agence.
st, data = http("/rest/v1/rpc/portal_case", "POST", {"p_token": jeton_a})
brut = json.dumps(data, ensure_ascii=False)
ok("assignee" not in brut and "amount_total" not in brut and "consulate_ref" not in brut,
   "le portail ne laisse fuir ni l'agent, ni la marge, ni la référence consulat")

st, data = http("/rest/v1/rpc/portal_mine", "POST",
                {"p_agency_slug": "tca", "p_device_token": "jeton-invente"})
vide = (not data) or (isinstance(data, dict) and not data.get("cases"))
ok(vide, "un jeton d'appareil inventé ne rend aucun dossier", str(data)[:80])

# Un anonyme ne touche aucune table, quoi qu'il demande.
for table in ("cases", "clients", "payments", "otp_codes", "profiles", "agencies"):
    st, _ = http(f"/rest/v1/{table}?select=*&limit=1")
    ok(st >= 400, f"un anonyme ne lit pas {table}", str(st))

# ---------------------------------------------------------------------
print("\n7 · Le stockage")
# ---------------------------------------------------------------------
for seau in ("pieces", "transport", "recus"):
    st, data = http(f"/storage/v1/object/list/{seau}", "POST", {"prefix": "", "limit": 5})
    ok(st >= 400 or data == [], f"le seau {seau} ne se liste pas sans compte", f"{st}")

print()
if rouges:
    print(f"{len(rouges)} FAILLE(S) sur {verts + len(rouges)} vérifications :")
    for r in rouges:
        print("  · " + r)
    sys.exit(1)
print(f"Banc d'étanchéité : {verts} vérifications, aucune faille.")
