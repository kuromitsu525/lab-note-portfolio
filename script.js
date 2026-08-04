// HTMLの要素を取得
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const timer = document.getElementById("timer");
const audioArea = document.getElementById("audioArea");

// 録音に使用する変数
let mediaRecorder;
let audioChunks = [];

// タイマー用の変数
let timerInterval;
let elapsedSeconds = 0;


// ブラウザが対応している録音形式を取得
function getSupportedMimeType() {

    const mimeTypes = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus"
    ];

    for (const mimeType of mimeTypes) {

        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }

    }

    return "";
}


// 録音開始
startButton.addEventListener("click", async () => {

    try {

        // マイクへのアクセスを要求
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });


        // 対応している録音形式を取得
        const mimeType = getSupportedMimeType();

        console.log("使用する録音形式:", mimeType);


        // MediaRecorderを作成
        if (mimeType) {

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType
            });

        } else {

            mediaRecorder = new MediaRecorder(stream);

        }


        // 録音データを初期化
        audioChunks = [];


        // 録音データを受け取る
        mediaRecorder.addEventListener("dataavailable", (event) => {

            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }

        });


        // 録音終了時の処理
        mediaRecorder.addEventListener("stop", () => {

            // 実際に使用された録音形式を取得
            const actualMimeType =
                mediaRecorder.mimeType || mimeType || "audio/webm";


            // 録音データからBlobを作成
            const audioBlob = new Blob(audioChunks, {
                type: actualMimeType
            });


            console.log("録音形式:", actualMimeType);
            console.log("録音データサイズ:", audioBlob.size);


            // 再生用URLを作成
            const audioURL = URL.createObjectURL(audioBlob);


            // audio要素を作成
            const audio = document.createElement("audio");

            audio.controls = true;
            audio.src = audioURL;


            // 画面に表示
            audioArea.innerHTML = "";
            audioArea.appendChild(audio);


            // マイクを停止
            stream.getTracks().forEach(track => track.stop());

        });


        // 録音開始
        mediaRecorder.start(1000);


        // ボタンの状態を変更
        startButton.disabled = true;
        stopButton.disabled = false;


        // タイマー開始
        elapsedSeconds = 0;
        timer.textContent = "00:00";


        timerInterval = setInterval(() => {

            elapsedSeconds++;

            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;

            timer.textContent =
                String(minutes).padStart(2, "0") +
                ":" +
                String(seconds).padStart(2, "0");

        }, 1000);


    } catch (error) {

        console.error("録音エラー:", error);

        alert("マイクへのアクセスに失敗しました。");

    }

});


// 録音停止
stopButton.addEventListener("click", () => {

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }


    // タイマー停止
    clearInterval(timerInterval);


    // ボタンの状態を変更
    startButton.disabled = false;
    stopButton.disabled = true;

});