package app.capmedia.visaflow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.util.Locale

class DateTest {

    @Test
    fun `une date ISO complete se met en forme`() {
        val text = formatDate("2026-10-11T09:30:00Z", Locale.FRANCE)
        assertNotEquals("—", text)
    }

    @Test
    fun `une date nue se met en forme aussi`() {
        // Le serveur envoie des `date` PostgreSQL sans heure ni fuseau : sans
        // ce repli, la moitié des dates du dossier s'affichaient en tiret.
        val text = formatDate("2026-10-11", Locale.FRANCE)
        assertNotEquals("—", text)
    }

    @Test
    fun `une date absente ou illisible affiche un tiret, jamais une erreur`() {
        assertEquals("—", formatDate(null))
        assertEquals("—", formatDate(""))
        assertEquals("—", formatDate("pas une date"))
    }
}
