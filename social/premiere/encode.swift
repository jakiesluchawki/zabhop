import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Product montages of source screenshots, not simulated screen recordings.
// All copy belongs in the full-canvas PNG overlay and is drawn on every frame.

private struct Box: Decodable {
    let x, y, width, height: Double
}

private struct Scene: Decodable {
    let image: String
    let duration: Double
    let box: Box
    let zoomFrom, zoomTo, focusX, focusY, radius: Double
}

private struct Job: Decodable {
    let id, output, background, previews: String
    let overlay: String?
    let width, height: Int
    let fps: Int32
    let scenes: [Scene]
}

private struct Plan: Decodable {
    let jobs: [Job]
}

private struct LoadedScene {
    let specification: Scene
    let imageURL: URL
    let image: CGImage
    let frames: Int
}

private struct LoadedJob {
    let specification: Job
    let outputURL: URL
    let previewURLs: [URL]
    let overlayURL: URL?
    let overlay: CGImage?
    let background: CGColor
    let scenes: [LoadedScene]

    var totalFrames: Int { scenes.reduce(0) { $0 + $1.frames } }
}

private struct Receipt: Encodable {
    let id, output, codec: String
    let width, height, fps, frames, audioTracks: Int
    let duration: Double
    let previews: [String]
}

private struct EncodingError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw EncodingError(message: message) }
}

private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

private func resolve(_ path: String, relativeTo directory: URL) -> URL {
    let expanded = (path as NSString).expandingTildeInPath
    return URL(fileURLWithPath: expanded, relativeTo: directory)
        .standardizedFileURL.resolvingSymlinksInPath()
}

private func loadImage(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { throw EncodingError(message: "Cannot read source image: \(url.path)") }
    try require(width > 0 && height > 0 && width <= 16_384 && height <= 16_384,
                "Invalid or oversized image: \(url.path)")
    // Honor EXIF orientation without reducing the original pixel dimensions.
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(width, height),
        kCGImageSourceShouldCacheImmediately: true,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { throw EncodingError(message: "Cannot decode source image: \(url.path)") }
    return image
}

private func parseColor(_ hex: String) throws -> CGColor {
    let value = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    try require(value.count == 6, "Background must be #RRGGBB")
    guard let rgb = UInt32(value, radix: 16),
          let color = CGColor(colorSpace: colorSpace, components: [
            CGFloat((rgb >> 16) & 255) / 255,
            CGFloat((rgb >> 8) & 255) / 255,
            CGFloat(rgb & 255) / 255,
            1,
          ])
    else { throw EncodingError(message: "Background must be #RRGGBB") }
    return color
}

private func validateAndLoad(_ plan: Plan, directory: URL, manifestURL: URL?) throws -> [LoadedJob] {
    try require(!plan.jobs.isEmpty, "Plan must contain at least one job")
    var identifiers = Set<String>()
    var outputPaths = Set<String>()
    var inputPaths = Set(manifestURL.map { [$0.path] } ?? [])
    var loaded: [LoadedJob] = []

    for job in plan.jobs {
        try require(job.id.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]*$", options: .regularExpression) != nil,
                    "Job id must be a non-empty filename-safe slug")
        try require(identifiers.insert(job.id).inserted, "Duplicate job id: \(job.id)")
        try require(job.width == 1080 && job.height == 1920 && job.fps == 30,
                    "\(job.id): expected 1080x1920 at 30 fps")
        try require(!job.scenes.isEmpty, "\(job.id): scenes must not be empty")
        try require(!job.output.isEmpty && !job.previews.isEmpty, "\(job.id): output and previews are required")

        let outputURL = resolve(job.output, relativeTo: directory)
        try require(outputURL.pathExtension.lowercased() == "mp4", "\(job.id): output must end in .mp4")
        let previewURLs = job.scenes.indices.map {
            resolve("\(job.previews)-\(job.id)-shot\($0 + 1).png", relativeTo: directory)
        }
        for url in [outputURL] + previewURLs {
            try require(outputPaths.insert(url.path).inserted, "Duplicate output path: \(url.path)")
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) {
                try require(!isDirectory.boolValue, "Output points to a directory: \(url.path)")
            }
        }

        let overlayURL = job.overlay.map { resolve($0, relativeTo: directory) }
        let overlay = try overlayURL.map(loadImage)
        if let overlay, let overlayURL {
            try require(overlay.width == job.width && overlay.height == job.height,
                        "\(job.id): overlay must be exactly 1080x1920")
            try require(overlayURL.pathExtension.lowercased() == "png", "\(job.id): overlay must be PNG")
            try require([CGImageAlphaInfo.premultipliedFirst, .premultipliedLast, .first, .last].contains(overlay.alphaInfo),
                        "\(job.id): overlay must have an alpha channel")
            inputPaths.insert(overlayURL.path)
        }

        var scenes: [LoadedScene] = []
        for (index, scene) in job.scenes.enumerated() {
            let label = "\(job.id), scene \(index + 1)"
            let b = scene.box
            try require([scene.duration, b.x, b.y, b.width, b.height, scene.zoomFrom,
                         scene.zoomTo, scene.focusX, scene.focusY, scene.radius].allSatisfy(\.isFinite),
                        "\(label): numeric values must be finite")
            try require(scene.duration > 0 && scene.duration <= 8, "\(label): invalid duration")
            try require(b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 &&
                        b.x + b.width <= Double(job.width) && b.y + b.height <= Double(job.height),
                        "\(label): box must fit inside the canvas")
            try require((1...1.15).contains(scene.zoomFrom) && (1...1.15).contains(scene.zoomTo),
                        "\(label): zoomFrom and zoomTo must be between 1 and 1.15")
            try require((0...1).contains(scene.focusX) && (0...1).contains(scene.focusY),
                        "\(label): focusX and focusY must be between 0 and 1")
            try require(scene.radius >= 0 && scene.radius <= min(b.width, b.height) / 2,
                        "\(label): invalid corner radius")
            let frameCount = Int((scene.duration * Double(job.fps)).rounded())
            try require(frameCount >= 1, "\(label): duration is shorter than one frame")
            let imageURL = resolve(scene.image, relativeTo: directory)
            inputPaths.insert(imageURL.path)
            scenes.append(LoadedScene(specification: scene, imageURL: imageURL,
                                      image: try loadImage(imageURL), frames: frameCount))
        }
        let jobLoaded = LoadedJob(specification: job, outputURL: outputURL,
                                  previewURLs: previewURLs, overlayURL: overlayURL, overlay: overlay,
                                  background: try parseColor(job.background), scenes: scenes)
        try require((180...240).contains(jobLoaded.totalFrames), "\(job.id): total duration must be 6–8 seconds")
        loaded.append(jobLoaded)
    }
    try require(outputPaths.isDisjoint(with: inputPaths), "An output path would overwrite a source image or manifest")
    return loaded
}

private func temporaryURL(nextTo finalURL: URL) -> URL {
    finalURL.deletingLastPathComponent()
        .appendingPathComponent(".\(finalURL.deletingPathExtension().lastPathComponent).\(UUID().uuidString).tmp.\(finalURL.pathExtension)")
}

private func ensureParent(of url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
}

private func publishAtomically(_ temporary: URL, to final: URL) throws {
    // Both paths are on the same filesystem. rename replaces a previous file
    // atomically, so a failed render never removes the previous valid export.
    let result = temporary.path.withCString { source in
        final.path.withCString { destination in Darwin.rename(source, destination) }
    }
    guard result == 0 else {
        throw EncodingError(message: "Cannot publish \(final.path): \(String(cString: strerror(errno)))")
    }
}

private func writePNG(_ image: CGImage, to finalURL: URL) throws {
    try ensureParent(of: finalURL)
    let temporary = temporaryURL(nextTo: finalURL)
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard let destination = CGImageDestinationCreateWithURL(
        temporary as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw EncodingError(message: "Cannot create PNG: \(finalURL.path)") }
    CGImageDestinationAddImage(destination, image, nil)
    try require(CGImageDestinationFinalize(destination), "Cannot finish PNG: \(finalURL.path)")
    try publishAtomically(temporary, to: finalURL)
}

private func renderFrame(scene: LoadedScene, index: Int, job: LoadedJob,
                         pool: CVPixelBufferPool) throws -> CVPixelBuffer {
    let spec = job.specification
    var allocated: CVPixelBuffer?
    try require(CVPixelBufferPoolCreatePixelBuffer(nil, pool, &allocated) == kCVReturnSuccess,
                "Cannot allocate video frame")
    guard let buffer = allocated else { throw EncodingError(message: "Missing video buffer") }
    CVBufferSetAttachment(buffer, kCVImageBufferCGColorSpaceKey, colorSpace, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
    CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    try require(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess, "Cannot lock video frame")
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer), width: spec.width, height: spec.height,
        bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: colorSpace,
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)
    else { throw EncodingError(message: "Cannot create frame drawing context") }

    let canvas = CGRect(x: 0, y: 0, width: spec.width, height: spec.height)
    context.interpolationQuality = .high
    context.setFillColor(job.background)
    context.fill(canvas)
    let s = scene.specification
    // JSON uses top-left coordinates; Quartz uses bottom-left coordinates.
    let box = CGRect(x: s.box.x, y: Double(spec.height) - s.box.y - s.box.height,
                     width: s.box.width, height: s.box.height)
    let progress = scene.frames == 1 ? 0.5 : Double(index) / Double(scene.frames - 1)
    let eased = progress * progress * (3 - 2 * progress)
    let zoom = s.zoomFrom + (s.zoomTo - s.zoomFrom) * eased
    let cover = max(box.width / CGFloat(scene.image.width), box.height / CGFloat(scene.image.height))
    let width = CGFloat(scene.image.width) * cover * zoom
    let height = CGFloat(scene.image.height) * cover * zoom
    // focus is a normalized crop anchor: 0 = left/top, 1 = right/bottom.
    // Zooming around that anchor creates deterministic subtle pan/zoom.
    let target = CGRect(x: box.minX - (width - box.width) * s.focusX,
                        y: box.minY - (height - box.height) * (1 - s.focusY),
                        width: width, height: height)
    context.saveGState()
    context.addPath(CGPath(roundedRect: box, cornerWidth: s.radius, cornerHeight: s.radius, transform: nil))
    context.clip()
    context.draw(scene.image, in: target)
    context.restoreGState()
    if let overlay = job.overlay {
        // No zoom, fade, motion, or copy change is ever applied to the overlay.
        context.draw(overlay, in: canvas)
    }
    return buffer
}

private func encode(_ job: LoadedJob) async throws -> Receipt {
    let spec = job.specification
    try ensureParent(of: job.outputURL)
    let temporary = temporaryURL(nextTo: job.outputURL)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let writer = try AVAssetWriter(outputURL: temporary, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: spec.width,
        AVVideoHeightKey: spec.height,
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 8_000_000,
            AVVideoExpectedSourceFrameRateKey: spec.fps,
            AVVideoMaxKeyFrameIntervalKey: spec.fps,
            AVVideoAllowFrameReorderingKey: false,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: spec.width,
        kCVPixelBufferHeightKey as String: spec.height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ])
    try require(writer.canAdd(input), "\(spec.id): cannot add video input")
    writer.add(input)
    guard writer.startWriting() else {
        throw EncodingError(message: "\(spec.id): cannot start writer: \(String(describing: writer.error))")
    }
    writer.startSession(atSourceTime: .zero)
    defer { if writer.status == .writing { writer.cancelWriting() } }
    guard let pool = adaptor.pixelBufferPool else { throw EncodingError(message: "Missing video buffer pool") }

    var globalFrame = 0
    var previewFrames: [Int] = []
    for scene in job.scenes {
        previewFrames.append(globalFrame + scene.frames / 2)
        for localFrame in 0..<scene.frames {
            try autoreleasepool {
                let deadline = Date().addingTimeInterval(30)
                while !input.isReadyForMoreMediaData {
                    try require(writer.status == .writing && Date() < deadline,
                                "\(spec.id): encoder stalled: \(String(describing: writer.error))")
                    Thread.sleep(forTimeInterval: 0.002)
                }
                let buffer = try renderFrame(scene: scene, index: localFrame, job: job, pool: pool)
                try require(adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(globalFrame), timescale: spec.fps)),
                            "\(spec.id): cannot append frame \(globalFrame): \(String(describing: writer.error))")
            }
            globalFrame += 1
        }
    }
    let endTime = CMTime(value: Int64(globalFrame), timescale: spec.fps)
    writer.endSession(atSourceTime: endTime)
    input.markAsFinished()
    await writer.finishWriting()
    try require(writer.status == .completed, "\(spec.id): encoding failed: \(String(describing: writer.error))")

    // Verify the encoded artifact, not just the requested writer settings.
    let asset = AVURLAsset(url: temporary)
    let tracks = try await asset.loadTracks(withMediaType: .video)
    let audio = try await asset.loadTracks(withMediaType: .audio)
    try require(tracks.count == 1 && audio.isEmpty, "\(spec.id): expected one silent video track")
    let track = tracks[0]
    let size = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let rate = try await track.load(.nominalFrameRate)
    let formats = try await track.load(.formatDescriptions)
    let duration = try await asset.load(.duration).seconds
    try require(size == CGSize(width: spec.width, height: spec.height) && transform.isIdentity,
                "\(spec.id): unexpected video dimensions or orientation")
    try require(abs(Double(rate) - Double(spec.fps)) < 0.01, "\(spec.id): unexpected video frame rate")
    try require(!formats.isEmpty && formats.allSatisfy { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 },
                "\(spec.id): video is not H.264")
    try require(abs(duration - endTime.seconds) < 0.5 / Double(spec.fps), "\(spec.id): unexpected video duration")

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    for (index, frame) in previewFrames.enumerated() {
        let time = CMTime(value: Int64(frame), timescale: spec.fps)
        let decoded = try await generator.image(at: time)
        try require(decoded.image.width == spec.width && decoded.image.height == spec.height,
                    "\(spec.id): unexpected decoded preview dimensions")
        try require(abs(decoded.actualTime.seconds - time.seconds) < 0.5 / Double(spec.fps),
                    "\(spec.id): preview does not match the requested scene midpoint")
        try writePNG(decoded.image, to: job.previewURLs[index])
    }
    try publishAtomically(temporary, to: job.outputURL)
    return Receipt(id: spec.id, output: job.outputURL.path, codec: "H.264",
                   width: spec.width, height: spec.height, fps: Int(spec.fps), frames: globalFrame,
                   audioTracks: 0, duration: duration, previews: job.previewURLs.map(\.path))
}

private func run() async throws {
    try require(CommandLine.arguments.count == 2, "Usage: encode <plan.json | ->")
    let argument = CommandLine.arguments[1]
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    let manifestURL = argument == "-" ? nil : resolve(argument, relativeTo: cwd)
    let data = try manifestURL.map { try Data(contentsOf: $0) } ?? FileHandle.standardInput.readDataToEndOfFile()
    let plan = try JSONDecoder().decode(Plan.self, from: data)
    let jobs = try validateAndLoad(plan, directory: manifestURL?.deletingLastPathComponent() ?? cwd, manifestURL: manifestURL)
    let json = JSONEncoder()
    json.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    for job in jobs {
        let receipt = try await encode(job)
        print(String(decoding: try json.encode(receipt), as: UTF8.self))
    }
}

do {
    try await run()
} catch {
    let detail = (error as? EncodingError)?.message ?? String(describing: error)
    FileHandle.standardError.write(Data("encode: \(detail)\n".utf8))
    exit(1)
}
