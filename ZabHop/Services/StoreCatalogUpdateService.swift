import CryptoKit
import Foundation

actor StoreCatalogUpdateService {
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
        static let lastAttempt = "storeCatalog.lastAttempt"
        static let lastSuccessfulCheck = "storeCatalog.lastSuccessfulCheck"
        static let installedSHA256 = "storeCatalog.installedSHA256"
    }

    static let manifestURL = URL(string: "https://jakiesluchawki.github.io/zabhop/stores-manifest.json")!
    static let successfulCheckInterval: TimeInterval = 24 * 60 * 60
    static let failedCheckRetryInterval: TimeInterval = 6 * 60 * 60

    private let session: URLSession
    private let defaults: UserDefaults
    private let fileManager: FileManager
    private let manifestURL: URL
    private let applicationSupportURL: URL

    init(
        session: URLSession = StoreCatalogUpdateService.makeSession(),
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        manifestURL: URL = StoreCatalogUpdateService.manifestURL,
        applicationSupportURL: URL? = nil
    ) {
        self.session = session
        self.defaults = defaults
        self.fileManager = fileManager
        self.manifestURL = manifestURL
        self.applicationSupportURL = applicationSupportURL
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    func installedCatalogURL() -> URL? {
        let url = catalogURL
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func checkForUpdate(now: Date = Date()) async -> UpdateResult {
        guard isCheckDue(now: now) else { return .notDue }
        defaults.set(now, forKey: DefaultsKey.lastAttempt)

        do {
            let manifest = try await loadManifest()
            if defaults.string(forKey: DefaultsKey.installedSHA256) == manifest.sha256,
               fileManager.fileExists(atPath: catalogURL.path) {
                defaults.set(now, forKey: DefaultsKey.lastSuccessfulCheck)
                return .unchanged
            }

            let remoteCatalogURL = try resolvedCatalogURL(path: manifest.catalogPath)
            let (data, response) = try await session.data(from: remoteCatalogURL)
            try Self.requireSuccessfulHTTPResponse(response)
            try Self.validate(data: data, manifest: manifest)
            try install(data: data)

            defaults.set(manifest.sha256, forKey: DefaultsKey.installedSHA256)
            defaults.set(now, forKey: DefaultsKey.lastSuccessfulCheck)
            return .updated(catalogURL)
        } catch {
            return .failed
        }
    }

    func isCheckDue(now: Date) -> Bool {
        if let lastSuccess = defaults.object(forKey: DefaultsKey.lastSuccessfulCheck) as? Date,
           now.timeIntervalSince(lastSuccess) < Self.successfulCheckInterval {
            return false
        }
        if let lastAttempt = defaults.object(forKey: DefaultsKey.lastAttempt) as? Date,
           now.timeIntervalSince(lastAttempt) < Self.failedCheckRetryInterval {
            return false
        }
        return true
    }

    static func validate(data: Data, manifest: Manifest) throws {
        guard manifest.schemaVersion == 1,
              manifest.storeCount >= 10_000,
              manifest.catalogPath == "stores.json",
              manifest.sha256.count == 64 else {
            throw CatalogUpdateError.invalidManifest
        }

        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == manifest.sha256.lowercased() else {
            throw CatalogUpdateError.checksumMismatch
        }

        let records = try JSONDecoder().decode([BundledStoreRecord].self, from: data)
        guard records.count == manifest.storeCount else {
            throw CatalogUpdateError.storeCountMismatch
        }
    }

    private var catalogDirectoryURL: URL {
        applicationSupportURL.appendingPathComponent("StoreCatalog", isDirectory: true)
    }

    private var catalogURL: URL {
        catalogDirectoryURL.appendingPathComponent("stores.json")
    }

    private func loadManifest() async throws -> Manifest {
        var request = URLRequest(url: manifestURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try Self.requireSuccessfulHTTPResponse(response)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Manifest.self, from: data)
    }

    private func resolvedCatalogURL(path: String) throws -> URL {
        guard path == "stores.json",
              let url = URL(string: path, relativeTo: manifestURL)?.absoluteURL,
              url.scheme == "https",
              url.host == manifestURL.host else {
            throw CatalogUpdateError.invalidCatalogURL
        }
        return url
    }

    private func install(data: Data) throws {
        try fileManager.createDirectory(at: catalogDirectoryURL, withIntermediateDirectories: true)
        let temporaryURL = catalogDirectoryURL.appendingPathComponent("stores.pending.json")
        try data.write(to: temporaryURL, options: [.atomic])
        if fileManager.fileExists(atPath: catalogURL.path) {
            _ = try fileManager.replaceItemAt(catalogURL, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: catalogURL)
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
