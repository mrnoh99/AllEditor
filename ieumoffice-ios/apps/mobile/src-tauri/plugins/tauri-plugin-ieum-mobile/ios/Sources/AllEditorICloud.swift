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

// ---- 문서 저장 위치 (설정 › 문서 저장 위치) ----
// The user picks where the AllEditor folder lives: iCloud Drive (default), On My iPad, or inside another folder of the
// Files app (a provider, an external drive…). The choice is kept in Application Support:
//   .storage-location  "icloud" | "local" | "custom"   (absent: never chosen, the iCloud default with its first move)
//   .storage-bookmark  the custom folder (a bookmark, since the app may only reach it through the picker's grant)
// Every launch turns the choice into the path written to .icloud-documents, which the Rust side reads.
private let aeLocationName = ".storage-location"
private let aeBookmarkName = ".storage-bookmark"
private var aeCustomAccess: URL? // the custom folder stays reachable while the app runs

func aeStorageChoice() -> String? {
    (try? String(contentsOf: aeSupportDir().appendingPathComponent(aeLocationName), encoding: .utf8))?
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
func aeSetStorageChoice(_ kind: String) {
    try? FileManager.default.createDirectory(at: aeSupportDir(), withIntermediateDirectories: true)
    try? kind.write(to: aeSupportDir().appendingPathComponent(aeLocationName), atomically: true, encoding: .utf8)
}
func aeICloudDocumentsURL() -> URL? {
    guard let c = FileManager.default.url(forUbiquityContainerIdentifier: nil) else { return nil }
    let d = c.appendingPathComponent("Documents", isDirectory: true)
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
}
func aeLocalDocumentsURL() -> URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

/// the AllEditor folder inside the folder the user picked (kept with a bookmark)
func aeCustomDocumentsURL() -> URL? {
    if let u = aeCustomAccess { return u }
    guard let data = try? Data(contentsOf: aeSupportDir().appendingPathComponent(aeBookmarkName)) else { return nil }
    var stale = false
    guard let parent = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
    _ = parent.startAccessingSecurityScopedResource()
    if stale, let fresh = try? parent.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        try? fresh.write(to: aeSupportDir().appendingPathComponent(aeBookmarkName))
    }
    let folder = parent.lastPathComponent == "AllEditor" ? parent : parent.appendingPathComponent("AllEditor", isDirectory: true)
    var err: NSError?
    NSFileCoordinator().coordinate(writingItemAt: folder, options: [], error: &err) { u in
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
    }
    aeCustomAccess = folder
    return folder
}
func aeSaveCustomBookmark(_ parent: URL) -> Bool {
    guard let data = try? parent.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return false }
    try? FileManager.default.createDirectory(at: aeSupportDir(), withIntermediateDirectories: true)
    do { try data.write(to: aeSupportDir().appendingPathComponent(aeBookmarkName)) } catch { return false }
    aeCustomAccess = nil
    return true
}
/// the kind folders the app saves into (한글 · Word · PowerPoint · Excel · PDF · Pages · Numbers · Keynote), made ahead so they are
/// there in the Files app from the start (same names as aeKindFolder / shim/runtime/folders.ts)
let aeKindFolderNames = ["HWP", "HWPX", "Word", "PowerPoint", "Excel", "PDF", "Pages", "Numbers", "Keynote"]
func aeEnsureKindFolders(_ root: URL) {
    let fm = FileManager.default
    // once per AllEditor folder (at install, or when a new location is chosen): a folder the user deletes later
    // is not made again; other kinds get their folder when their first file is saved
    let done = aeSupportDir().appendingPathComponent(".kind-folders-3") // -3: HWP and HWPX replaced Hangul
    let made = (try? String(contentsOf: done, encoding: .utf8))?.components(separatedBy: "\n") ?? []
    if made.contains(root.standardizedFileURL.path) { return }
    try? fm.createDirectory(at: aeSupportDir(), withIntermediateDirectories: true)
    try? (made.filter { !$0.isEmpty } + [root.standardizedFileURL.path]).joined(separator: "\n").write(to: done, atomically: true, encoding: .utf8)
    for name in aeKindFolderNames {
        let dir = root.appendingPathComponent(name, isDirectory: true)
        if fm.fileExists(atPath: dir.path) { continue }
        var err: NSError?
        NSFileCoordinator().coordinate(writingItemAt: dir, options: [], error: &err) { u in
            try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        }
    }
}

/// point the Rust side at a folder (nil: the local Documents folder)
func aeWriteDocumentsMarker(_ url: URL?) {
    aeEnsureKindFolders(url ?? aeLocalDocumentsURL())
    let marker = aeSupportDir().appendingPathComponent(aeICloudMarkerName)
    try? FileManager.default.createDirectory(at: aeSupportDir(), withIntermediateDirectories: true)
    if let url { try? url.path.write(to: marker, atomically: true, encoding: .utf8) } else { try? FileManager.default.removeItem(at: marker) }
}

func aeSetupICloudDocuments() {
    DispatchQueue.global(qos: .utility).async {
        let fm = FileManager.default
        let marker = aeSupportDir().appendingPathComponent(aeICloudMarkerName)
        switch aeStorageChoice() {
        case "local":
            aeWriteDocumentsMarker(nil); return
        case "custom":
            // the picked folder; if it cannot be reached any more, the documents of On My iPad are used meanwhile
            aeWriteDocumentsMarker(aeCustomDocumentsURL()); return
        default: break
        }
        let chosen = aeStorageChoice() == "icloud" // chosen in 설정: no automatic move of the iPad's documents
        guard let container = fm.url(forUbiquityContainerIdentifier: nil) else {
            try? fm.removeItem(at: marker) // no iCloud now: back to On My iPad
            aeEnsureKindFolders(aeLocalDocumentsURL())
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
        if !chosen, let items = try? fm.contentsOfDirectory(at: local, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
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
        aeEnsureKindFolders(cloudDocs)
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
