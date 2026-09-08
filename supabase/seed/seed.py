#!/usr/bin/env python3
"""Monte le jeu de démonstration sur un projet Supabase réel.

Deux agences, de vrais comptes d'authentification, et des données qui vivent
en base plutôt que dans le paquet du navigateur. Les comptes sont réels parce
que le banc d'étanchéité s'y connecte ensuite pour éprouver le mur avec de
vrais jetons : un test qui se contente de psql ne teste pas la porte d'entrée.

    export SUPABASE_ACCESS_TOKEN=sbp_...      # jeton personnel
    export SUPABASE_PROJECT_REF=...
    export SUPABASE_SERVICE_KEY=...           # pour créer les comptes
    python3 supabase/seed/seed.py
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

REF = os.environ.get("SUPABASE_PROJECT_REF", "")
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
SERVICE = os.environ.get("SUPABASE_SERVICE_KEY", "")
URL = os.environ.get("SUPABASE_URL", f"https://{REF}.supabase.co")

# Un mot de passe unique et connu : ce sont des comptes de démonstration sur
# un projet de démonstration. Ils n'existeront jamais sur un projet client.
PASSWORD = "VisaFlow!Demo2026"

COMPTES = [
    ("TCA_OWNER",   "slim@tunis-consulting.test"),
    ("TCA_MANAGER", "amira@tunis-consulting.test"),
    ("TCA_AGENT",   "hatem@tunis-consulting.test"),
    ("TCA_TRIPOLI", "najat@tunis-consulting.test"),
    ("TCA_VIEWER",  "stage@tunis-consulting.test"),
    ("SAH_OWNER",   "rania@sahara-voyages.test"),
    ("SAH_AGENT",   "anis@sahara-voyages.test"),
]


def http(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    # Sans agent utilisateur crédible, Cloudflare renvoie 1010 devant l'API
    # de gestion, et l'erreur ne dit rien du contenu.
    req.add_header("User-Agent", "visaflow-seed/1.0")
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            raw = res.read().decode()
            return json.loads(raw) if raw else None, None
    except urllib.error.HTTPError as e:
        return None, e.read().decode()


def sql(query):
    return http(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        "POST", {"query": query},
        {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )


def admin(path, method="GET", body=None):
    return http(
        f"{URL}/auth/v1/{path}", method, body,
        {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"},
    )


def compte(email):
    """Rend l'identifiant du compte, qu'il existe déjà ou non."""
    data, err = admin("admin/users", "POST", {
        "email": email, "password": PASSWORD, "email_confirm": True,
    })
    if data and data.get("id"):
        return data["id"], "créé"
    # Rejouable : un compte déjà présent se retrouve par son adresse.
    found, _ = admin(f"admin/users?filter={urllib.parse.quote(email)}")
    users = (found or {}).get("users", [])
    for u in users:
        if u.get("email") == email:
            return u["id"], "existant"
    raise SystemExit(f"compte introuvable et non créable : {email} · {err}")


def main():
    for name in ("SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_KEY"):
        if not os.environ.get(name):
            raise SystemExit(f"variable manquante : {name}")

    ids = {}
    for cle, email in COMPTES:
        ids[cle], etat = compte(email)
        print(f"  {etat:9} {email}")

    script = (pathlib.Path(__file__).parent / "demo.sql").read_text(encoding="utf-8")
    for cle, uid in ids.items():
        script = script.replace("{{" + cle + "}}", uid)

    if "{{" in script:
        raise SystemExit("un jeton n'a pas été remplacé dans demo.sql")

    # Les trois blocs `do $$` partent ensemble : l'API de gestion accepte un
    # script entier, et un demi-jeu de données serait pire que rien.
    _, err = sql(script)
    if err:
        raise SystemExit("échec du jeu de données :\n" + err[:3000])

    data, _ = sql("""
        select a.slug, a.name,
               (select count(*) from profiles p where p.agency_id = a.id) as comptes,
               (select count(*) from clients c where c.agency_id = a.id) as clients,
               (select count(*) from cases c where c.agency_id = a.id) as dossiers,
               (select count(*) from shipments s where s.agency_id = a.id) as cargaisons,
               (select count(*) from appointment_queue q where q.agency_id = a.id and q.status='attente') as en_file
        from agencies a where a.slug in ('tca','sahara') order by a.slug desc;
    """)
    print()
    for row in data or []:
        print("  {slug:8} {comptes} comptes · {clients} clients · {dossiers} dossiers · "
              "{cargaisons} cargaisons · {en_file} en file".format(**row))
    print(f"\n  mot de passe des comptes de démonstration : {PASSWORD}")


if __name__ == "__main__":
    import urllib.parse
    main()
