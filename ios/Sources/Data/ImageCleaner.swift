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
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            // Un PDF ou un format que l'on ne sait pas relire part tel quel :
            // mieux vaut envoyer la pièce que la perdre. Les PDF ne portent pas
            // de GPS.
            return data
        }

        // On réduit à 2000 px sur le grand côté : un passeport reste lisible,
        // mais une connexion à 25 Mbps en Libye ne s'étrangle pas sur une photo
        // de douze mégapixels. thumbnail crée une image déjà sans métadonnées.
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2000,
        ]
        let scaled = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) ?? image

        let out = NSMutableData()
        // On force le JPEG en sortie : petit, universel, et sans profil EXIF.
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return data }
        CGImageDestinationAddImage(dest, scaled, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return data }
        return out as Data
    }
}
