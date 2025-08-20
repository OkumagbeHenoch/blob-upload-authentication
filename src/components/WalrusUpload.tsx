// WalrusUploaderFlowBinary.tsx
import React, { useEffect, useState } from "react";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { WalrusClient, WalrusFile } from "@mysten/walrus";
import walrusWasmUrl from "@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url";

export default function WalrusUploaderFlowBinary() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [walrusClient, setWalrusClient] = useState<WalrusClient | null>(null);
  const [clientReady, setClientReady] = useState(false);

  const [flow, setFlow] = useState<any | null>(null);
  const [encoded, setEncoded] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [blobId, setBlobId] = useState<string | null>(null);
  const [filesMeta, setFilesMeta] = useState<any[]>([]);
  const [status, setStatus] = useState<string>("Idle");
  const [busy, setBusy] = useState<boolean>(false);

  const [inputBlobId, setInputBlobId] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus("Initializing clients...");
      const wasmUrl = walrusWasmUrl ?? "https://unpkg.com/@mysten/walrus-wasm@latest/web/walrus_wasm_bg.wasm";

      try {
        const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });

        const client = new WalrusClient({
          network: "testnet",
          suiClient,
          wasmUrl,
        });

        if (!mounted) return;
        setWalrusClient(client);
        setClientReady(true);
        setStatus("Walrus client ready");
      } catch (err: any) {
        console.error("Failed to create WalrusClient:", err);
        setStatus("Failed to initialize Walrus client: " + (err?.message ?? String(err)));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!clientReady || !walrusClient) {
      setStatus("Walrus client not ready");
      return;
    }
    if (busy) return;
    setBusy(true);

    try {
      setStatus("Reading file...");
      setFlow(null);
      setEncoded(false);
      setDigest(null);
      setBlobId(null);
      setFilesMeta([]);

      const file = e.target.files?.[0];
      if (!file) {
        setStatus("No file selected");
        setBusy(false);
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      if (typeof (walrusClient as any).writeFilesFlow !== "function") {
        console.error("walrusClient missing writeFilesFlow:", walrusClient);
        setStatus("Walrus client missing writeFilesFlow method.");
        setBusy(false);
        return;
      }

      const newFlow = walrusClient.writeFilesFlow({
        files: [
          WalrusFile.from({
            contents: uint8Array,
            identifier: file.name,
            tags: { "content-type": file.type || "application/octet-stream" },
          }),
        ],
      });

      setStatus("Encoding...");
      await newFlow.encode();

      setFlow(newFlow);
      setEncoded(true);
      setStatus(`Encoded "${file.name}". Ready to Register.`);
    } catch (err: any) {
      console.error("Encode error:", err);
      setStatus("Encode failed: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    if (!clientReady || !walrusClient) return setStatus("Walrus client not ready");
    if (!flow) return setStatus("No flow to register");
    if (!account) return setStatus("Connect wallet first");
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Preparing register transaction...");
      const registerTx = flow.register({ epochs: 3, owner: account.address, deletable: true });
      setStatus("Signing & executing register tx...");
      const result = await signAndExecuteTransaction({ transaction: registerTx });
      setDigest(result?.digest ?? null);
      setStatus("Registered. Digest saved. Now upload.");
      console.log("Register result:", result);
    } catch (err: any) {
      console.error("Register error:", err);
      setStatus("Register failed: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!clientReady || !walrusClient) return setStatus("Walrus client not ready");
    if (!flow) return setStatus("No flow to upload");
    if (!digest) return setStatus("No digest available — register first");
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Uploading to storage nodes...");
      await flow.upload({ digest });
      setStatus("Upload complete. Click Certify next.");
    } catch (err: any) {
      console.error("Upload error:", err);
      setStatus("Upload failed: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleCertify = async () => {
    if (!clientReady || !walrusClient) return setStatus("Walrus client not ready");
    if (!flow) return setStatus("No flow to certify");
    if (!account) return setStatus("Connect wallet first");
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Preparing certify tx...");
      const certifyTx = flow.certify();
      setStatus("Signing & executing certify tx...");
      await signAndExecuteTransaction({ transaction: certifyTx });
      setStatus("Certified. Fetching files...");
      const listed = await flow.listFiles();
      setFilesMeta(listed);
      if (listed.length > 0) {
        setBlobId(listed[0].blobId);
        setStatus("Done. Blob ID available.");
      } else {
        setStatus("Certified but flow.listFiles() returned nothing.");
      }
    } catch (err: any) {
      console.error("Certify error:", err);
      setStatus("Certify failed: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const createDownloadFromWalrusFile = async (walrusFile: any) => {
    const identifier = (await walrusFile.getIdentifier()) ?? inputBlobId ?? "walrus-file";
    const tags = (await walrusFile.getTags()) ?? {};
    const contentType = tags["content-type"] ?? "application/octet-stream";
    const bytes = await walrusFile.bytes();
    const blob = new Blob([bytes], { type: contentType });

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setDownloadName(identifier);
    setStatus("File ready to download");
  };

  const handleDownloadById = async () => {
    if (!clientReady || !walrusClient) return setStatus("Walrus client not ready");
    if (!inputBlobId) return setStatus("Enter a Blob ID first");
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Fetching file from Walrus...");
      const [walrusFile] = await walrusClient.getFiles({ ids: [inputBlobId] });
      if (!walrusFile) throw new Error("No file returned by walrus");
      await createDownloadFromWalrusFile(walrusFile);
    } catch (err: any) {
      console.error("Download error:", err);
      setStatus("Download failed: " + (err?.message ?? String(err)));
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        setDownloadUrl(null);
        setDownloadName(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadUploaded = async () => {
    if (!clientReady || !walrusClient) return setStatus("Walrus client not ready");
    if (!blobId) return setStatus("No uploaded blobId available");
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Fetching uploaded blob...");
      const [walrusFile] = await walrusClient.getFiles({ ids: [blobId] });
      if (!walrusFile) throw new Error("No file returned by walrus");
      await createDownloadFromWalrusFile(walrusFile);
    } catch (err: any) {
      console.error("Download uploaded error:", err);
      setStatus("Failed to fetch uploaded blob: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3>Walrus Upload Flow (binary-safe)</h3>

      <div>
        <input type="file" onChange={handleFileChange} disabled={!clientReady || busy} />
        <div>Status: {status}</div>
      </div>

      <div>
        <button onClick={handleRegister} disabled={!flow || !encoded || !account || busy}>
          Register
        </button>
        <button onClick={handleUpload} disabled={!flow || !digest || busy}>
          Upload
        </button>
        <button onClick={handleCertify} disabled={!flow || !account || busy}>
          Certify
        </button>
      </div>

      {blobId && (
        <p>
          ✅ Blob ID: {blobId}
        </p>
      )}

      <h3>Download by Blob ID</h3>
      <div>
        <input
          type="text"
          value={inputBlobId}
          placeholder="Enter Blob ID..."
          onChange={(e) => setInputBlobId(e.target.value)}
          disabled={!clientReady || busy}
        />
        <button onClick={handleDownloadById} disabled={!clientReady || busy}>
          Retrieve File
        </button>
      </div>
    </div>
  );
}
