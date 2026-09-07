package app.capmedia.visaflow

import app.capmedia.visaflow.data.json
import app.capmedia.visaflow.model.CaseBundle
import app.capmedia.visaflow.model.DocState
import app.capmedia.visaflow.model.MineBundle
import app.capmedia.visaflow.model.Stage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le décodage est le seul endroit où le serveur et l'application peuvent
 * diverger sans que personne s'en aperçoive avant la production. On le teste
 * sur des charges utiles écrites à la main, pas générées depuis nos propres
 * classes : un test qui encode puis décode ne prouve rien.
 */
class ModelTest {

    @Test
    fun `un dossier se decode avec les noms de colonnes du serveur`() {
        val payload = """
        {
          "case": {
            "reference": "VF-2026-0148",
            "stage": "rendez_vous",
            "status": "ouvert",
            "travel_date": "2026-10-11T00:00:00Z",
            "balance": 180.0,
            "currency": "TND"
          },
          "agency": { "name": "Tunis Consulting", "mark": "TC", "inpdp_ref": "INPDP-2026-0148" },
          "visa": { "country": {"fr":"France"}, "label": {"fr":"Schengen"}, "processing_days": 18 },
          "documents": [
            { "key": "passeport", "label": {"fr":"Passeport"}, "state": "validee", "required": true },
            { "key": "releves", "label": {"fr":"Relevés"}, "state": "manquante", "required": true }
          ],
          "queue": { "rank": 4, "total": 11, "city": "Tunis", "wait_days": 23 },
          "messages": []
        }
        """.trimIndent()

        val bundle = json.decodeFromString<CaseBundle>(payload)
        assertEquals("VF-2026-0148", bundle.visaCase.reference)
        assertEquals(Stage.RENDEZ_VOUS, bundle.visaCase.stage)
        assertEquals("INPDP-2026-0148", bundle.agency.inpdpRef)
        assertEquals(18, bundle.visa.processingDays)
        assertEquals(4, bundle.queue?.rank)
        assertEquals(1, bundle.missing.size)
        assertEquals(0.5f, bundle.progress, 0.001f)
    }

    @Test
    fun `un champ inconnu du serveur ne casse pas une application deja installee`() {
        val payload = """
        {
          "case": { "reference": "X", "stage": "clos", "status": "accepte", "colonne_de_demain": 42 },
          "agency": { "name": "A" },
          "visa": {},
          "documents": []
        }
        """.trimIndent()
        val bundle = json.decodeFromString<CaseBundle>(payload)
        assertEquals("X", bundle.visaCase.reference)
    }

    @Test
    fun `l'avancement ignore les pieces facultatives`() {
        val payload = """
        {
          "case": { "reference": "X", "stage": "pieces", "status": "ouvert" },
          "agency": { "name": "A" },
          "visa": {},
          "documents": [
            { "key": "a", "state": "validee", "required": true },
            { "key": "b", "state": "manquante", "required": false }
          ]
        }
        """.trimIndent()
        val bundle = json.decodeFromString<CaseBundle>(payload)
        // Une pièce facultative manquante ne doit pas afficher 50 % au client
        // alors que son dossier est complet.
        assertEquals(1f, bundle.progress, 0.001f)
        assertTrue(bundle.missing.any { it.key == "b" })
    }

    @Test
    fun `l'accueil marque chaque ligne selon sa liste d'origine`() {
        val payload = """
        {
          "ok": true,
          "cases": [{ "reference": "VF-1", "token": "t1" }],
          "shipments": [{ "reference": "CG-1", "token": "t2" }],
          "requests": []
        }
        """.trimIndent()
        val mine = json.decodeFromString<MineBundle>(payload)
        val all = mine.all
        assertEquals(2, all.size)
        assertEquals(app.capmedia.visaflow.model.MineItem.Kind.DOSSIER, all[0].kind)
        assertEquals(app.capmedia.visaflow.model.MineItem.Kind.CARGAISON, all[1].kind)
    }

    @Test
    fun `une piece validee n'est plus en attente`() {
        assertTrue(DocState.MANQUANTE.isPending)
        assertTrue(DocState.REFUSEE.isPending)
        assertTrue(!DocState.VALIDEE.isPending)
    }
}
