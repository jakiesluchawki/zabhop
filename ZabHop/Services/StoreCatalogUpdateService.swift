import CryptoKit
import Foundation

actor StoreCatalogUpdateService {
    enum Catalog: String, CaseIterable, Sendable {
        case zabka
        case other

        var catalogPath: String {
            switch self {
            case .zabka: "stores.json"
            case .other: "other-stores.json"
            }
        }

        var manifestPath: String {
            switch self {
            case .zabka: "stores-manifest.json"
            case .other: "other-stores-manifest.json"
            }
        }

        var successfulCheckInterval: TimeInterval {
            switch self {
            case .zabka: 24 * 60 * 60
            case .other: 7 * 24 * 60 * 60
            }
        }

        fileprivate var defaultsPrefix: String {
            switch self {
            case .zabka: "storeCatalog"
            case .other: "storeCatalog.other"
            }
        }
    }

    struct Manifest: Decodable, Equatable {
        let schemaVersion: Int
        let generatedAt: Date
        let sha256: String
        let storeCount: Int
        let catalogPath: String
    }

    enum UpdateResult: Equatable {
        case notDue
        case unchanged
        case updated(URL)
        case failed
    }

    private enum DefaultsKey {
        static func lastAttempt(for catalog: Catalog) -> String {
            "\(catalog.defaultsPrefix).lastAttempt"
        }

        static func lastSuccessfulCheck(for catalog: Catalog) -> String {
            "\(catalog.defaultsPrefix).lastSuccessfulCheck"
        }

        static func installedSHA256(for catalog: Catalog) -> String {
            "\(catalog.defaultsPrefix).installedSHA256"
        }
    }

    static let catalogBaseURL = URL(string: "https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/")!
    static let manifestURL = catalogBaseURL.appendingPathComponent(Catalog.zabka.manifestPath)
    static let failedCheckRetryInterval: TimeInterval = 6 * 60 * 60

    private let session: URLSession
    private let defaults: UserDefaults
    private let fileManager: FileManager
    private let catalogBaseURL: URL
    private let applicationSupportURL: URL

    init(
        session: URLSession = StoreCatalogUpdateService.makeSession(),
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        catalogBaseURL: URL = StoreCatalogUpdateService.catalogBaseURL,
        applicationSupportURL: URL? = nil
    ) {
        self.session = session
        self.defaults = defaults
        self.fileManager = fileManager
        self.catalogBaseURL = catalogBaseURL
        self.applicationSupportURL = applicationSupportURL
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    func installedCatalogURL(for catalog: Catalog = .zabka) -> URL? {
        let url = catalogURL(for: catalog)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func checkForUpdate(
        catalog: Catalog = .zabka,
        bundledCatalogURL: URL? = nil,
        now: Date = Date(),
        force: Bool = false
    ) async -> UpdateResult {
        guard force || isCheckDue(for: catalog, now: now) else { return .notDue }
        defaults.set(now, forKey: DefaultsKey.lastAttempt(for: catalog))

        do {
            let manifest = try await loadManifest(for: catalog)
            try Self.validateManifest(manifest, for: catalog)

            let installedURL = catalogURL(for: catalog)
            if defaults.string(forKey: DefaultsKey.installedSHA256(for: catalog))?.lowercased()
                == manifest.sha256.lowercased(),
               fileManager.fileExists(atPath: installedURL.path) {
                defaults.set(now, forKey: DefaultsKey.lastSuccessfulCheck(for: catalog))
                return .unchanged
            }

            if let bundledCatalogURL,
               try Self.catalog(at: bundledCatalogURL, matches: manifest) {
                let replacedOutdatedCatalog = fileManager.fileExists(atPath: installedURL.path)
                if replacedOutdatedCatalog {
                    try fileManager.removeItem(at: installedURL)
                }
                defaults.set(manifest.sha256.lowercased(), forKey: DefaultsKey.installedSHA256(for: catalog))
                defaults.set(now, forKey: DefaultsKey.lastSuccessfulCheck(for: catalog))
                return replacedOutdatedCatalog ? .updated(bundledCatalogURL) : .unchanged
            }

            let remoteCatalogURL = try resolvedCatalogURL(path: manifest.catalogPath, catalog: catalog)
            let (data, response) = try await session.data(from: remoteCatalogURL)
            try Self.requireSuccessfulHTTPResponse(response)
            try Self.validate(data: data, manifest: manifest, for: catalog)
            try install(data: data, for: catalog)

            defaults.set(manifest.sha256.lowercased(), forKey: DefaultsKey.installedSHA256(for: catalog))
            defaults.set(now, forKey: DefaultsKey.lastSuccessfulCheck(for: catalog))
            return .updated(installedURL)
        } catch {
            return .failed
        }
    }

    func isCheckDue(for catalog: Catalog = .zabka, now: Date) -> Bool {
        if let lastSuccess = defaults.object(forKey: DefaultsKey.lastSuccessfulCheck(for: catalog)) as? Date,
           now.timeIntervalSince(lastSuccess) < catalog.successfulCheckInterval {
            return false
        }
        if let lastAttempt = defaults.object(forKey: DefaultsKey.lastAttempt(for: catalog)) as? Date,
           now.timeIntervalSince(lastAttempt) < Self.failedCheckRetryInterval {
            return false
        }
        return true
    }

    static func validate(
        data: Data,
        manifest: Manifest,
        for catalog: Catalog = .zabka
    ) throws {
        try validateManifest(manifest, for: catalog)

        guard sha256(for: data) == manifest.sha256.lowercased() else {
            throw CatalogUpdateError.checksumMismatch
        }

        let decodedCount: Int
        switch catalog {
        case .zabka:
            decodedCount = try JSONDecoder().decode([BundledStoreRecord].self, from: data).count
        case .other:
            decodedCount = try JSONDecoder().decode([BundledOtherStoreRecord].self, from: data).count
        }
        guard decodedCount == manifest.storeCount else {
            throw CatalogUpdateError.storeCountMismatch
        }
    }

    static func catalog(at url: URL, matches manifest: Manifest) throws -> Bool {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return sha256(for: data) == manifest.sha256.lowercased()
    }

    private static func validateManifest(_ manifest: Manifest, for catalog: Catalog) throws {
        guard manifest.schemaVersion == 1,
              manifest.storeCount >= 10_000,
              manifest.catalogPath == catalog.catalogPath,
              manifest.sha256.count == 64,
              manifest.sha256.allSatisfy({ $0.isHexDigit }) else {
            throw CatalogUpdateError.invalidManifest
        }
    }

    private static func sha256(for data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private var catalogDirectoryURL: URL {
        applicationSupportURL.appendingPathComponent("StoreCatalog", isDirectory: true)
    }

    private func catalogURL(for catalog: Catalog) -> URL {
        catalogDirectoryURL.appendingPathComponent(catalog.catalogPath)
    }

    private func loadManifest(for catalog: Catalog) async throws -> Manifest {
        var request = URLRequest(url: catalogBaseURL.appendingPathComponent(catalog.manifestPath))
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try Self.requireSuccessfulHTTPResponse(response)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Manifest.self, from: data)
    }

    private func resolvedCatalogURL(path: String, catalog: Catalog) throws -> URL {
        guard path == catalog.catalogPath,
              let url = URL(string: path, relativeTo: catalogBaseURL)?.absoluteURL,
              url.scheme == "https",
              url.host == catalogBaseURL.host,
              url.path.hasPrefix(catalogBaseURL.path) else {
            throw CatalogUpdateError.invalidCatalogURL
        }
        return url
    }

    private func install(data: Data, for catalog: Catalog) throws {
        try fileManager.createDirectory(at: catalogDirectoryURL, withIntermediateDirectories: true)
        let destinationURL = catalogURL(for: catalog)
        let temporaryURL = catalogDirectoryURL.appendingPathComponent("\(catalog.rawValue).pending.json")
        try data.write(to: temporaryURL, options: [.atomic])
        if fileManager.fileExists(atPath: destinationURL.path) {
            _ = try fileManager.replaceItemAt(destinationURL, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
        }
    }

    private static func requireSuccessfulHTTPResponse(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else {
            throw CatalogUpdateError.unsuccessfulResponse
        }
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.allowsConstrainedNetworkAccess = false
        configuration.allowsExpensiveNetworkAccess = true
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 45
        return URLSession(configuration: configuration)
    }
}

enum CatalogUpdateError: Error {
    case invalidManifest
    case checksumMismatch
    case storeCountMismatch
    case invalidCatalogURL
    case unsuccessfulResponse
}
