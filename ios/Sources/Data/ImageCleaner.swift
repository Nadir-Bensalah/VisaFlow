import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Retire les métadonnées d'une image avant l'envoi.
///
/// Une photo prise au téléphone porte, par défaut, la position GPS de l'endroit
/// où elle a été prise, la date exacte et le modèle d'appareil. Sur un dossier
/// d'immigration, la localisation du domicile du client est une donnée sensible
/// qui fuirait sans qu'il le sache. On ré-encode donc l'image en ne gardant que
/// les pixels, jamais le dictionnaire EXIF ni GPS.
enum ImageCleaner {
    static func stripped(_ data: Data) -> Data {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let type = CGImageSourceGetType(source),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            // Un PDF ou un format que l'on ne sait pas relire part tel quel :
            // mieux vaut envoyer la pièce que la perdre. Les PDF ne portent pas
            // de GPS.
            return data
        }

        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, type, 1, nil) else { return data }
        // On n'écrit aucune propriété : ni EXIF, ni GPS, ni TIFF. Que les pixels.
        CGImageDestinationAddImage(dest, image, [:] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return data }
        return out as Data
    }
}
