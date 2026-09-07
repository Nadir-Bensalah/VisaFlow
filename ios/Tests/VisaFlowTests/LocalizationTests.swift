import Foundation
import Testing
@testable import VisaFlow

/// Une traduction manquante ne se voit pas au compilateur : elle se voit chez
/// un client libyen qui reçoit la moitié de son écran en français. Ce test
/// compare les quatre fichiers, clé par clé.
@Suite("Traductions")
struct LocalizationTests {

    private static let languages = ["fr", "en", "ar", "zh-Hans"]

    private func keys(for language: String) throws -> Set<String> {
        let bundle = Bundle(for: BundleMarker.self)
        guard let url = bundle.url(forResource: "Localizable", withExtension: "strings",
                                   subdirectory: nil, localization: language)
                ?? Bundle.main.url(forResource: "Localizable", withExtension: "strings",
                                   subdirectory: nil, localization: language)
        else {
            throw LocalizationError.missingFile(language)
        }
        let data = try Data(contentsOf: url)
        let plist = try PropertyListSerialization.propertyList(from: data, format: nil)
        guard let dictionary = plist as? [String: String] else {
            throw LocalizationError.unreadable(language)
        }
        return Set(dictionary.keys)
    }

    @Test("Les quatre langues portent exactement les mêmes clés")
    func sameKeysEverywhere() throws {
        let reference = try keys(for: "fr")
        #expect(reference.count > 100)

        for language in Self.languages.dropFirst() {
            let other = try keys(for: language)
            let missing = reference.subtracting(other)
            let extra = other.subtracting(reference)
            #expect(missing.isEmpty, "\(language) : clés manquantes \(missing.sorted())")
            #expect(extra.isEmpty, "\(language) : clés en trop \(extra.sorted())")
        }
    }

    @Test("Aucune traduction n'est vide")
    func noEmptyValue() throws {
        for language in Self.languages {
            let bundle = Bundle(for: BundleMarker.self)
            guard let url = bundle.url(forResource: "Localizable", withExtension: "strings",
                                       subdirectory: nil, localization: language)
                    ?? Bundle.main.url(forResource: "Localizable", withExtension: "strings",
                                       subdirectory: nil, localization: language)
            else { continue }
            let data = try Data(contentsOf: url)
            let plist = try PropertyListSerialization.propertyList(from: data, format: nil)
            let dictionary = plist as? [String: String] ?? [:]
            for (key, value) in dictionary {
                #expect(!value.trimmingCharacters(in: .whitespaces).isEmpty, "\(language) · \(key)")
            }
        }
    }

    @Test("Toutes les étapes du métier ont un libellé")
    func stagesAreTranslated() throws {
        let reference = try keys(for: "fr")
        for stage in Stage.allCases {
            #expect(reference.contains(stage.titleKey), "manque \(stage.titleKey)")
        }
        for stage in ShipmentStage.allCases {
            #expect(reference.contains(stage.titleKey), "manque \(stage.titleKey)")
        }
        for state in [DocState.manquante, .demandee, .recue, .validee, .refusee, .expiree] {
            #expect(reference.contains(state.titleKey), "manque \(state.titleKey)")
        }
    }
}

private enum LocalizationError: Error {
    case missingFile(String)
    case unreadable(String)
}

/// Sert seulement à désigner le bundle des tests.
private final class BundleMarker {}
