// macOS software check only. This does not prove a WeChat real-device scan.
import Foundation
import ImageIO
import Vision
import CryptoKit

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: qr-native-decode <image> <expected-sha256>\n", stderr)
    exit(2)
}
let expected = CommandLine.arguments[2]
guard expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Invalid digest or image\n", stderr)
    exit(2)
}
do {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let matches = (request.results ?? []).compactMap { $0.payloadStringValue }.filter {
        SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined() == expected
    }
    guard matches.count == 1 else {
        fputs("QR decode missing, ambiguous, or digest mismatch\n", stderr)
        exit(1)
    }
    print("PASS: macOS Vision independently decoded one QR with the expected payload digest")
} catch {
    fputs("Native QR decoding failed\n", stderr)
    exit(1)
}
