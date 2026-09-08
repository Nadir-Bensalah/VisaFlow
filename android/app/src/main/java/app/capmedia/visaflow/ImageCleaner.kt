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
        // On réduit à 2000 px sur le grand côté : un passeport reste lisible,
        // mais une connexion faible ne s'étrangle pas sur une photo de douze
        // mégapixels. Le redimensionnement crée un bitmap neuf, sans EXIF.
        val max = 2000
        val scaled = if (maxOf(bitmap.width, bitmap.height) > max) {
            val ratio = max.toFloat() / maxOf(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).toInt(), (bitmap.height * ratio).toInt(), true)
        } else bitmap
        return ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, out)
            if (scaled !== bitmap) scaled.recycle()
            bitmap.recycle()
            out.toByteArray()
        }
    }
}
