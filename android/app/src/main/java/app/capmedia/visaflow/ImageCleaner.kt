package app.capmedia.visaflow

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream

/**
 * Retire les métadonnées d'une image avant l'envoi.
 *
 * Une photo prise au téléphone porte, par défaut, la position GPS de l'endroit
 * où elle a été prise. Sur un dossier d'immigration, la localisation du domicile
 * du client est sensible et fuirait sans qu'il le sache. On décode puis
 * recompresse l'image : le bitmap ne porte que les pixels, jamais l'EXIF.
 */
object ImageCleaner {
    fun stripped(data: ByteArray): ByteArray {
        // Un PDF ou un format non décodable part tel quel : mieux vaut envoyer
        // la pièce que la perdre, et un PDF ne porte pas de GPS.
        val bitmap: Bitmap = runCatching { BitmapFactory.decodeByteArray(data, 0, data.size) }
            .getOrNull() ?: return data
        return ByteArrayOutputStream().use { out ->
            // JPEG de bonne qualité, sans le moindre attribut EXIF recopié.
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            bitmap.recycle()
            out.toByteArray()
        }
    }
}
