import Foundation

// AllEditor documents in iCloud Drive: the app's iCloud container (iCloud.com.mrnoh99.alleditor) is public, so its
// Documents folder shows as "AllEditor" in iCloud Drive (Files app, Mac Finder, iCloud.com).
//
// At launch (off the main thread, as Apple requires for the container lookup):
//   1. find the container; without iCloud (signed out, iCloud Drive off, no entitlement) nothing changes and the
//      documents stay in On My iPad › AllEditor
//   2. move the documents of On My iPad › AllEditor into it once (a name already in iCloud is left where it is)
//   3. ask iCloud to download every document, so the editors can read them
//   4. tell the Rust side (src-tauri/src/office.rs `storage_root`) where the documents now live: the path is written
//      to Library/Application Support/AllEditorOffice/.icloud-documents; without that file the local folder is used

private let aeICloudMarkerName = ".icloud-documents"

private func aeSupportDir() -> URL {
    let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    return lib.appendingPathComponent("Application Support/AllEditorOffice", isDirectory: true)
}

func aeSetupICloudDocuments() {
    DispatchQueue.global(qos: .utility).async {
        let fm = FileManager.default
        let marker = aeSupportDir().appendingPathComponent(aeICloudMarkerName)
        guard let container = fm.url(forUbiquityContainerIdentifier: nil) else {
            try? fm.removeItem(at: marker) // no iCloud now: back to On My iPad
            return
        }
        let cloudDocs = container.appendingPathComponent("Documents", isDirectory: true)
        do {
            try fm.createDirectory(at: cloudDocs, withIntermediateDirectories: true)
        } catch {
            NSLog("[AllEditor] iCloud Documents unavailable: \(error.localizedDescription)")
            return
        }

        // one-time move of the local documents (and any left behind later, e.g. saved while iCloud was off)
        let local = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        if let items = try? fm.contentsOfDirectory(at: local, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            for item in items {
                let target = cloudDocs.appendingPathComponent(item.lastPathComponent)
                if fm.fileExists(atPath: target.path) { continue }
                do { try fm.setUbiquitous(true, itemAt: item, destinationURL: target) } catch {
                    NSLog("[AllEditor] could not move \(item.lastPathComponent) to iCloud: \(error.localizedDescription)")
                }
            }
        }

        // documents only in the cloud (placeholders) are downloaded, so they open
        if let items = try? fm.contentsOfDirectory(at: cloudDocs, includingPropertiesForKeys: nil, options: []) {
            for item in items {
                let name = item.lastPathComponent
                if name.hasPrefix(".") && name.hasSuffix(".icloud") {
                    let real = cloudDocs.appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
                    try? fm.startDownloadingUbiquitousItem(at: real)
                } else {
                    try? fm.startDownloadingUbiquitousItem(at: item)
                }
            }
        }

        try? fm.createDirectory(at: aeSupportDir(), withIntermediateDirectories: true)
        try? cloudDocs.path.write(to: marker, atomically: true, encoding: .utf8)
    }
}

/// where the documents live now: iCloud Drive › AllEditor once set up, else On My iPad › AllEditor
func aeDocumentsDir() -> URL {
    let marker = aeSupportDir().appendingPathComponent(aeICloudMarkerName)
    if let p = try? String(contentsOf: marker, encoding: .utf8) {
        let url = URL(fileURLWithPath: p.trimmingCharacters(in: .whitespacesAndNewlines), isDirectory: true)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue { return url }
    }
    return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
}
