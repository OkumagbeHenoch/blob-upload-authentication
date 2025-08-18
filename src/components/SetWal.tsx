import React, { useMemo, useState, useEffect } from "react";
import { SuiClient } from "@mysten/sui/client";
import { ConnectButton, useSignAndExecuteTransaction, useCurrentAccount } from "@mysten/dapp-kit";
import { WalrusClient, WalrusFile } from "@mysten/walrus";

// TypeScript interfaces
interface WalrusFileMetadata {
  blobId: string;
  identifier?: string;
  tags?: { [key: string]: string };
  headers?: { [key: string]: string };
}

interface FetchedFileMetadata {
  blobId: string;
  contentType: string;
  size: number;
  identifier?: string;
}

export default function WalrusUploadComponent() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; value: number } | null>(null);
  const [filesList, setFilesList] = useState<WalrusFileMetadata[]>([]);
  const [epochs, setEpochs] = useState<number>(3);
  const [fetchBlobId, setFetchBlobId] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fetchedMeta, setFetchedMeta] = useState<FetchedFileMetadata | null>(null);
  const [isOneClickRunning, setIsOneClickRunning] = useState(false);
  const [flow, setFlow] = useState<any | null>(null);
  const [registerDigest, setRegisterDigest] = useState<string | null>(null);

  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const rpcUrl = "https://fullnode.testnet.sui.io:443";
  const { suiClient, walrusClient } = useMemo(() => {
    const sui = new SuiClient({ url: rpcUrl });
    const walrus = new WalrusClient({ network: "testnet", suiClient: sui });
    return { suiClient: sui, walrusClient: walrus };
  }, []);

  // Cleanup preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function checkBalance() {
    if (!account) {
      setStatus("Connect your wallet first");
      return false;
    }
    try {
      const balance = await suiClient.getBalance({ owner: account.address });
      const suiBalance = parseInt(balance.totalBalance) / 1_000_000_000;
      if (suiBalance < 0.1) {
        setStatus("Insufficient SUI balance for transactions (need ~0.1 SUI)");
        return false;
      }
      return true;
    } catch (err) {
      setStatus(`Balance check failed: ${err.message || "Unknown error"}`);
      return false;
    }
  }

  function onFileChange(e) {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      if (f.size > 100 * 1024 * 1024) {
        setStatus("File too large. Maximum size is 100MB.");
        setFile(null);
        return;
      }
      setStatus(`Selected ${f.name} (${f.size} bytes)`);
    } else {
      setStatus(null);
    }
    setFile(f);
    setFilesList([]);
    setFlow(null);
    setRegisterDigest(null);
  }

  async function fileToUint8(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (!reader.result) {
          reject(new Error("File reader returned no data."));
        } else {
          resolve(new Uint8Array(reader.result));
        }
      };
      reader.onerror = (e) => reject(new Error(`File read error: ${e.target.error.message}`));
      reader.readAsArrayBuffer(f);
    });
  }

  async function startEncode() {
    if (!file) {
      setStatus("No file selected");
      return;
    }
    if (file.size === 0) {
      setStatus("File is empty");
      return;
    }
    setStatus("Encoding...");
    setProgress({ step: "encode", value: 0 });
    try {
      const data = await fileToUint8(file);

      const walrusFile = new WalrusFile({
        arrayBuffer: data.buffer,
        identifier: file.name,
        tags: { "content-type": file.type || "application/octet-stream" },
      });

      const newFlow = walrusClient.writeFilesFlow({ files: [walrusFile] });
      if (!newFlow) throw new Error("Failed to create writeFilesFlow");

      await newFlow.encode();
      setFlow(newFlow);
      setProgress({ step: "encode", value: 100 });
      setStatus("Encoded — ready to register");
      return newFlow;
    } catch (err) {
      setStatus(`Encode failed: ${err.message || "Unknown error"}`);
      setProgress(null);
    }
  }

  async function handleRegister(currentFlow) {
    const activeFlow = currentFlow || flow;
    if (!activeFlow) {
      setStatus("Call Encode first");
      return;
    }
    if (!account) {
      setStatus("Connect your wallet first");
      return;
    }
    if (!(await checkBalance())) return;

    setStatus("Preparing register transaction...");
    setProgress({ step: "register", value: 0 });
    try {
      const registerTx = activeFlow.register({ epochs, owner: account.address, deletable: true });
      setStatus("Requesting wallet signature for register tx...");
      setProgress({ step: "register", value: 50 });
      
      const res = await new Promise((resolve, reject) => {
        signAndExecute(
          { transaction: registerTx },
          {
            onSuccess: (result) => resolve(result),
            onError: (err) => reject(err),
          }
        );
      });

      const digest = res.digest;
      setRegisterDigest(digest);
      setProgress({ step: "register", value: 100 });
      setStatus(`Register tx executed: ${digest}`);
      return digest;
    } catch (err) {
      setStatus(`Register failed: ${err.message || "Unknown error"}`);
      setProgress(null);
    }
  }

  async function handleUpload(currentFlow, digest) {
    const activeFlow = currentFlow || flow;
    const activeDigest = digest || registerDigest;
    if (!activeFlow || !activeDigest) {
      setStatus("Encode & Register first");
      return;
    }

    setStatus("Uploading shards to storage nodes...");
    setProgress({ step: "upload", value: 0 });
    try {
      await activeFlow.upload({
        digest: activeDigest,
        onProgress: (p) => {
          setProgress({ step: "upload", value: Math.round(p * 100) });
        },
      });
      setProgress({ step: "upload", value: 100 });
      setStatus("Upload complete — ready to certify");
    } catch (err) {
      setStatus(`Upload failed: ${err.message || "Unknown error"}`);
      setProgress(null);
    }
  }

  async function handleCertify(currentFlow) {
    const activeFlow = currentFlow || flow;
    if (!activeFlow) {
      setStatus("Encode first");
      return;
    }
    if (!account) {
      setStatus("Connect your wallet first");
      return;
    }
    if (!(await checkBalance())) return;

    setStatus("Signing & executing certify tx...");
    setProgress({ step: "certify", value: 0 });
    try {
      const certifyTx = activeFlow.certify();
      setProgress({ step: "certify", value: 50 });

      const res = await new Promise((resolve, reject) => {
        signAndExecute(
          { transaction: certifyTx },
          {
            onSuccess: (result) => resolve(result),
            onError: (err) => reject(err),
          }
        );
      });

      const digest = res.digest;
      const files = await activeFlow.listFiles();
      setFilesList(files ?? []);
      setProgress({ step: "certify", value: 100 });
      setStatus(`Certify tx executed: ${digest}. Files listed below.`);
      setFlow(null);
      setRegisterDigest(null);
    } catch (err) {
      setStatus(`Certify failed: ${err.message || "Unknown error"}`);
      setProgress(null);
    }
  }

  async function handleQuickOneClickWrite() {
    if (!file) return setStatus("No file selected");
    if (!account) return setStatus("Connect your wallet first");
    if (!(await checkBalance())) return;

    setIsOneClickRunning(true);
    setStatus("Starting one-click upload flow...");
    try {
      const encodedFlow = await startEncode();
      if (!encodedFlow) throw new Error("Encode failed");

      const registerDigestResult = await handleRegister(encodedFlow);
      if (!registerDigestResult) throw new Error("Register failed");

      await handleUpload(encodedFlow, registerDigestResult);

      await handleCertify(encodedFlow);
    } catch (err) {
      setStatus(`One-click flow failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsOneClickRunning(false);
    }
  }

  async function fetchBlobAndPreview(blobId) {
    if (!/^[a-zA-Z0-9-_]+$/.test(blobId)) {
      setStatus("Invalid blobId format");
      return;
    }
    setStatus(`Fetching blob ${blobId} ...`);
    setFetchedMeta(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    try {
      const walrusFiles = await walrusClient.getFiles({ ids: [blobId] });
      if (!walrusFiles?.length) throw new Error("No file returned from getFiles");
      const fetchedFile = walrusFiles[0];
      const ab = await fetchedFile.arrayBuffer();
      const contentType = fetchedFile.tags?.["content-type"] || fetchedFile.headers?.["content-type"] || "application/octet-stream";
      const blob = new Blob([ab], { type: contentType });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setFetchedMeta({ blobId, contentType, size: ab?.byteLength ?? 0, identifier: fetchedFile.identifier });
      setStatus("Fetched — preview available below");
    } catch (err) {
      try {
        const bytes = await walrusClient.readBlob({ blobId });
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setFetchedMeta({ blobId, contentType: "application/octet-stream", size: bytes.length });
        setStatus("Fetched (via readBlob) — download available below");
      } catch (err2) {
        setStatus(`Fetch failed: ${err2.message || "Unknown error"}`);
      }
    }
  }

  function downloadPreviewAs(filename) {
    if (!previewUrl || !fetchedMeta) return setStatus("No preview available to download");
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = filename ?? fetchedMeta.identifier ?? `${fetchedMeta.blobId}.bin`;
    a.click();
    setStatus("Download initiated");
  }

  async function handleFetchInput() {
    if (!fetchBlobId) return setStatus("Enter a blobId to fetch");
    await fetchBlobAndPreview(fetchBlobId.trim());
  }

  return (
    <div>
      <h2>Walrus Upload & Retrieve (browser)</h2>

      {!account && (
        <div>
          <ConnectButton />
          <p>Please connect your wallet to proceed.</p>
        </div>
      )}
      {account && <p>Connected: {account.address}</p>}

      <div>
        <label>Choose file (max 100MB)</label>
        <input type="file" onChange={onFileChange} />
      </div>

      <div>
        {!isOneClickRunning && (
          <>
            <button onClick={startEncode} disabled={!file || !account}>
              Encode
            </button>
            <button onClick={() => handleRegister()} disabled={!flow || !account}>
              Register
            </button>
            <button onClick={() => handleUpload()} disabled={!flow || !registerDigest}>
              Upload
            </button>
            <button onClick={() => handleCertify()} disabled={!flow || !registerDigest || !account}>
              Certify
            </button>
          </>
        )}
        <button onClick={handleQuickOneClickWrite} disabled={!file || isOneClickRunning || !account}>
          {isOneClickRunning ? "Running..." : "One-click Upload"}
        </button>
      </div>

      <div>
        <div>Status: <strong>{status ?? "idle"}</strong></div>
        {progress && (
          <div>
            <div>
              {progress.step.charAt(0).toUpperCase() + progress.step.slice(1)} progress: {progress.value}%
            </div>
            <div>
              <progress value={progress.value} max="100" />
            </div>
          </div>
        )}
      </div>

      <hr />

      <div>
        <h3>Uploaded files</h3>
        <div>
          {filesList.length === 0 && <div>No files listed yet</div>}
          {filesList.map((f, i) => (
            <div key={i}>
              <div>
                <strong>{f.identifier ?? "Untitled"}</strong>
              </div>
              <div>blobId: {f.blobId}</div>
              <div>
                <button
                  onClick={() => {
                    setFetchBlobId(f.blobId);
                    fetchBlobAndPreview(f.blobId);
                  }}
                >
                  Fetch
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(f.blobId);
                    setStatus(`Copied blobId: ${f.blobId}`);
                  }}
                >
                  Copy blobId
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <hr />

      <div>
        <h3>Fetch by blobId</h3>
        <div>
          <input
            value={fetchBlobId}
            onChange={(e) => setFetchBlobId(e.target.value)}
            placeholder="Enter blobId"
          />
          <button onClick={handleFetchInput}>Fetch</button>
        </div>

        {previewUrl && fetchedMeta && (
          <div>
            <h4>Preview ({fetchedMeta.contentType})</h4>
            <div>
              {fetchedMeta.contentType.startsWith("image/") && <img src={previewUrl} alt="preview" />}
              {fetchedMeta.contentType.startsWith("video/") && <video src={previewUrl} controls />}
              {!fetchedMeta.contentType.startsWith("image/") &&
                !fetchedMeta.contentType.startsWith("video/") && (
                  <div>Binary preview available — click download to save the file.</div>
                )}
            </div>
            <div>
              <button onClick={() => downloadPreviewAs()}>Download</button>
              <button
                onClick={() => {
                  if (previewUrl) {
                    URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                    setFetchedMeta(null);
                    setStatus("Preview cleared");
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}