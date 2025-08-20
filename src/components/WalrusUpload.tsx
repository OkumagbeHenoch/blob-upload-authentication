// WalrusUploaderFlowBinary.tsx
import React, { useEffect, useState } from "react";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { WalrusClient, WalrusFile } from "@mysten/walrus";
import walrusWasmUrl from "@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url";

export default function BlobUploader() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [walrusClient, setWalrusClient] = useState<WalrusClient | null>(null);
  const [clientReady, setClientReady] = useState(false);

  const [flow, setFlow] = useState<any | null>(null);
  const [encoded, setEncoded] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [blobId, setBlobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [busy, setBusy] = useState<boolean>(false);

  const [inputBlobId, setInputBlobId] = useState("");

  useEffect(() => {
    let connected = true;
    (async () => {
      setStatus("Initializing clients...");
      const wasmUrl = walrusWasmUrl ?? "https://unpkg.com/@mysten/walrus-wasm@latest/web/walrus_wasm_bg.wasm";
      try {
        const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
        const client = new WalrusClient({ network: "testnet", suiClient, wasmUrl });
        if (!connected) return;
        setWalrusClient(client);
        setClientReady(true);
        setStatus("Walrus client ready");
      } catch (err: any) {
        console.error("Failed to create WalrusClient:", err);
        setStatus("Failed to initialize Walrus client: " + (err?.message ?? String(err)));
      }
    })();
    return () => {
      connected = false;
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
    if (busy) return;

    setBusy(true);
    try {
      setStatus("Preparing certify tx...");
      const certifyTx = flow.certify();
      setStatus("Signing & executing certify tx...");
      await signAndExecuteTransaction({ transaction: certifyTx });
      setStatus("Certified. Fetching files...");
      const listed = await flow.listFiles();
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

  return (
    <div>
      <h3>Blob Upload</h3>

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

      <div>
        <input
          type="text"
          value={inputBlobId}
          placeholder="Enter Blob ID..."
          onChange={(e) => setInputBlobId(e.target.value)}
          disabled={!clientReady || busy}
        />

      </div>
    </div>
  );
}
