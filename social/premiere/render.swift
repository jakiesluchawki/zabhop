import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers

struct Rect: Codable { var x: CGFloat; var y: CGFloat; var width: CGFloat; var height: CGFloat; var cg: CGRect { CGRect(x:x,y:y,width:width,height:height) } }
struct TextLayer: Decodable { var text: String; var box: Rect; var size: CGFloat; var font: String; var color: String; var lineHeight: CGFloat; var align: String?; var tracking: CGFloat? }
struct ImageLayer: Decodable { var path: String; var box: Rect; var radius: CGFloat?; var animated: Bool?; var border: String?; var borderWidth: CGFloat? }
struct Artwork: Decodable { var id: String; var format: String; var background: String; var width: Int; var height: Int; var texts: [TextLayer]; var images: [ImageLayer] }
struct Crop: Decodable { var id: String; var source: String; var rect: Rect }
struct Plan: Decodable { var root: String; var output: String; var build: String; var crops: [Crop]; var artworks: [Artwork] }
enum Failure: Error { case invalid(String) }
var layoutProblems: [String] = []
func checkLayout(_ value: Bool, _ message: String) { if !value { layoutProblems.append(message) } }
func require(_ value: Bool, _ message: String) throws { if !value { throw Failure.invalid(message) } }
func color(_ value: String) -> NSColor {
    let rgb = UInt32(value.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16)!
    return NSColor(srgbRed: CGFloat((rgb >> 16) & 255)/255, green: CGFloat((rgb >> 8) & 255)/255, blue: CGFloat(rgb & 255)/255, alpha: 1)
}
func loadImage(_ path: String) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath:path) as CFURL,nil), let image = CGImageSourceCreateImageAtIndex(source,0,nil) else { throw Failure.invalid("Missing image: \(path)") }
    return image
}
func save(_ image: CGImage, to file: String, jpeg: Bool = false) throws {
    let url = URL(fileURLWithPath:file)
    try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, (jpeg ? UTType.jpeg.identifier : UTType.png.identifier) as CFString, 1, nil) else { throw Failure.invalid("Cannot save \(file)") }
    CGImageDestinationAddImage(dest,image,jpeg ? [kCGImageDestinationLossyCompressionQuality:0.96] as CFDictionary : nil)
    try require(CGImageDestinationFinalize(dest),"Cannot finish \(file)")
}
func drawImage(_ image: CGImage, in box: Rect, radius: CGFloat, border: String? = nil, borderWidth: CGFloat = 0) {
    let context = NSGraphicsContext.current!.cgContext
    context.saveGState()
    let round = NSBezierPath(roundedRect:box.cg,xRadius:radius,yRadius:radius)
    round.addClip()
    let source = NSImage(cgImage:image,size:NSSize(width:image.width,height:image.height))
    let scale = max(box.width / CGFloat(image.width), box.height / CGFloat(image.height))
    let target = CGRect(x:box.x-(CGFloat(image.width)*scale-box.width)/2,y:box.y-(CGFloat(image.height)*scale-box.height)/2,width:CGFloat(image.width)*scale,height:CGFloat(image.height)*scale)
    source.draw(in:target,from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:[.interpolation:NSImageInterpolation.high])
    context.restoreGState()
    if let border = border, borderWidth > 0 { color(border).setStroke(); round.lineWidth=borderWidth; round.stroke() }
}
func render(_ item: Artwork, root: String, overlay: Bool = false) throws -> (CGImage, [[String:Any]]) {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:item.width,pixelsHigh:item.height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0), let original = NSGraphicsContext(bitmapImageRep:bitmap) else { throw Failure.invalid("Canvas") }
    let cg = original.cgContext
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    cg.translateBy(x:0,y:CGFloat(item.height)); cg.scaleBy(x:1,y:-1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext:cg,flipped:true)
    cg.interpolationQuality = .high
    if !overlay { color(item.background).setFill(); NSRect(x:0,y:0,width:item.width,height:item.height).fill() }
    for layer in item.images where !overlay || layer.animated != true {
        let path = URL(fileURLWithPath:root).appendingPathComponent(layer.path).path
        let image = try loadImage(path)
        drawImage(image,in:layer.box,radius:layer.radius ?? 0,border:layer.border,borderWidth:layer.borderWidth ?? 0)
    }
    var boxes: [[String:Any]] = []
    for layer in item.texts {
        guard let font = NSFont(name:layer.font,size:layer.size) else { throw Failure.invalid("Original font unavailable: \(layer.font)") }
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight=layer.lineHeight; paragraph.maximumLineHeight=layer.lineHeight
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.alignment = layer.align == "right" ? .right : layer.align == "center" ? .center : .left
        let string = NSAttributedString(string:layer.text,attributes:[.font:font,.foregroundColor:color(layer.color),.paragraphStyle:paragraph,.kern:layer.tracking ?? 0])
        let measured = string.boundingRect(with:CGSize(width:layer.box.width,height:10000),options:[.usesLineFragmentOrigin,.usesFontLeading])
        checkLayout(measured.height <= layer.box.height+1,"\(item.id): text too high (\(measured.height) > \(layer.box.height)): \(layer.text)")
        checkLayout(layer.box.x >= 60 && layer.box.x+layer.box.width <= 1020,"\(item.id): horizontal safe area")
        let top: CGFloat = item.format == "story" ? 220 : 60
        let bottom: CGFloat = item.format == "story" ? 1704 : 1290
        checkLayout(layer.box.y >= top && layer.box.y+measured.height <= bottom,"\(item.id): vertical safe area")
        if item.format == "story" {
            let sticker = CGRect(x:240,y:1510,width:600,height:120)
            let actual = CGRect(x:layer.box.x,y:layer.box.y,width:layer.box.width,height:measured.height)
            checkLayout(!actual.intersects(sticker),"\(item.id): text in sticker area")
        }
        // Draw the whole measured copy even in a draft; validation below fails closed.
        let drawBox = CGRect(x:layer.box.x,y:layer.box.y,width:layer.box.width,height:max(layer.box.height,measured.height+1))
        string.draw(with:drawBox,options:[.usesLineFragmentOrigin,.usesFontLeading])
        boxes.append(["text":layer.text,"font":layer.font,"size":layer.size,"x":layer.box.x,"y":layer.box.y,"width":measured.width,"height":measured.height])
    }
    for layer in item.images where item.format == "story" {
        checkLayout(!layer.box.cg.intersects(CGRect(x:240,y:1510,width:600,height:120)),"\(item.id): image in sticker area")
    }
    guard let output = bitmap.cgImage else { throw Failure.invalid("Canvas image") }
    return (output,boxes)
}
func resize(_ image:CGImage,width:Int) throws -> CGImage {
    let height = Int((Double(image.height)*Double(width)/Double(image.width)).rounded())
    guard let context = CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure.invalid("Thumbnail") }
    context.interpolationQuality = .high; context.draw(image,in:CGRect(x:0,y:0,width:width,height:height)); return context.makeImage()!
}

let arguments = CommandLine.arguments
try require(arguments.count == 2,"Usage: xcrun swift social/premiere/render.swift plan.json")
let plan = try JSONDecoder().decode(Plan.self,from:Data(contentsOf:URL(fileURLWithPath:arguments[1])))
for name in ["Romie-Regular","Roobert-Regular","Roobert-Bold"] {
    let url = URL(fileURLWithPath:plan.root).appendingPathComponent("ZabHop/Resources/Fonts/\(name).otf")
    var error:Unmanaged<CFError>?
    let registered = CTFontManagerRegisterFontsForURL(url as CFURL,.process,&error)
    try require(registered,"Cannot register original font \(name)")
}
for crop in plan.crops {
    let source = try loadImage(URL(fileURLWithPath:plan.root).appendingPathComponent(crop.source).path)
    try require(crop.rect.x>=0 && crop.rect.y>=0 && crop.rect.x+crop.rect.width<=CGFloat(source.width) && crop.rect.y+crop.rect.height<=CGFloat(source.height),"Crop out of bounds")
    guard let image = source.cropping(to:crop.rect.cg) else { throw Failure.invalid("Crop \(crop.id)") }
    try save(image,to:plan.build+"/crops/\(crop.id).png")
}
var audit: [[String:Any]] = []
for item in plan.artworks {
    let issueCount = layoutProblems.count
    let (image,boxes) = try render(item,root:plan.root)
    try save(image,to:plan.output+"/images/\(item.id).jpg",jpeg:true)
    try save(try resize(image,width:432),to:plan.output+"/images/\(item.id)-preview.jpg",jpeg:true)
    if item.format == "story" {
        let (overlay,_) = try render(item,root:plan.root,overlay:true)
        try save(overlay,to:plan.build+"/overlays/\(item.id).png")
    }
    let valid = issueCount == layoutProblems.count
    audit.append(["id":item.id,"width":item.width,"height":item.height,"texts":boxes,"safeZones":valid,"fonts":"Original Romie / Roobert OTF, process-only registration"])
    print("Rendered \(item.id): \(item.width)×\(item.height), layout \(valid ? "OK" : "needs adjustment")")
}
let auditURL = URL(fileURLWithPath:plan.build+"/render-audit.json")
try JSONSerialization.data(withJSONObject:audit,options:[.prettyPrinted,.sortedKeys]).write(to:auditURL,options:.atomic)
if !layoutProblems.isEmpty {
    FileHandle.standardError.write(Data((layoutProblems.joined(separator:"\n")+"\n").utf8))
    exit(1)
}
