(function(){
    "use strict";

    const QUEUE_KEY = "sobSyncQueue";
    const OCR_SCRIPT =
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

    let ocrTimer = null;
    let ocrBusy = false;
    let ocrCanvas = null;
    let ocrContext = null;
    let ocrVideo = null;
    let originalCloseScanner = null;

    function readQueue(){
        try{
            const value = JSON.parse(
                localStorage.getItem(QUEUE_KEY) || "[]"
            );

            return Array.isArray(value) ? value : [];
        }catch(error){
            return [];
        }
    }

    function writeQueue(queue){
        localStorage.setItem(QUEUE_KEY,JSON.stringify(queue));
    }

    function queuePayload(payload){
        const queue = readQueue();
        const key = [
            payload.action || "CREATE",
            payload.entryId || "",
            payload.sob || "",
            payload.date || ""
        ].join("|");

        if(!queue.some(item => item.key === key)){
            queue.push({
                key,
                payload,
                addedAt:Date.now()
            });

            writeQueue(queue);
        }

        setCloudStatus("offline");
    }

    function removeQueuedPayload(payload){
        const key = [
            payload.action || "CREATE",
            payload.entryId || "",
            payload.sob || "",
            payload.date || ""
        ].join("|");

        writeQueue(
            readQueue().filter(item => item.key !== key)
        );
    }

    const originalPostToCloud = window.postToCloud;

    window.postToCloud = function(payload){
        return originalPostToCloud(payload)
            .then(response => {
                if(
                    response &&
                    (
                        response.status === "success" ||
                        response.status === "deleted" ||
                        response.status === "duplicate"
                    )
                ){
                    removeQueuedPayload(payload);
                }

                return response;
            })
            .catch(error => {
                queuePayload(payload);
                throw error;
            });
    };

    window.syncOfflineQueue = async function(){
        if(!navigator.onLine) return;

        const queue = readQueue();

        if(!queue.length){
            setCloudStatus("success");
            return;
        }

        setCloudStatus("syncing");

        for(const item of queue){
            try{
                const response = await originalPostToCloud(item.payload);

                if(
                    response.status === "success" ||
                    response.status === "deleted" ||
                    response.status === "duplicate"
                ){
                    removeQueuedPayload(item.payload);
                }
            }catch(error){
                setCloudStatus("offline");
                return;
            }
        }

        setCloudStatus("success");
    };

    /*
     * Reset only the currently selected username.
     * The old implementation sent one RESET request per row
     * and did not send the selected username.
     */
    window.resetAllData = async function(){
        const username = usernameInput.value.trim();

        if(!username){
            alert("Enter or select a username first.");
            usernameInput.focus();
            return;
        }

        if(!data.length){
            alert("There is no data for the selected user.");
            return;
        }

        if(!confirm("Reset today's data for " + username + "?")){
            return;
        }

        const payload = {
            action:"RESET",
            date:todayString(),
            displayName:username,
            deviceId
        };

        try{
            const response = await originalPostToCloud(payload);

            if(response.status !== "success"){
                throw new Error(
                    response.message || "Reset failed."
                );
            }

            data = [];
            saveLocalData();
            render();
            setCloudStatus("success");
        }catch(error){
            queuePayload(payload);

            data = [];
            saveLocalData();
            render();

            alert(
                "Reset saved offline. It will sync automatically when online."
            );
        }
    };

    function ensurePopupStyle(){
        if(document.getElementById("scanPopupStyle")) return;

        const style = document.createElement("style");
        style.id = "scanPopupStyle";
        style.textContent = `
            #scanSavedPopup{
                position:fixed;
                left:50%;
                top:50%;
                z-index:100002;
                transform:translate(-50%,-50%) scale(.7);
                padding:12px 22px;
                border-radius:28px;
                color:#fff;
                background:#00a83b;
                font-size:18px;
                font-weight:bold;
                box-shadow:0 6px 25px #0006;
                opacity:0;
                pointer-events:none;
                transition:.18s ease;
            }

            #scanSavedPopup.show{
                transform:translate(-50%,-50%) scale(1);
                opacity:1;
            }

            #ocrHighlight{
                position:fixed;
                z-index:100001;
                display:none;
                border:3px solid #00e676;
                border-radius:8px;
                box-shadow:0 0 0 9999px #0003,0 0 18px #00e676;
                pointer-events:none;
                transition:.12s ease;
            }

            body.dark select{
                background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Cpath d='M1 3l5 5 5-5' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E");
            }

            body:not(.dark) select{
                background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Cpath d='M1 3l5 5 5-5' fill='none' stroke='%23000000' stroke-width='2'/%3E%3C/svg%3E");
            }
        `;

        document.head.appendChild(style);

        const popup = document.createElement("div");
        popup.id = "scanSavedPopup";
        popup.textContent = "✓ Saved!";
        document.body.appendChild(popup);

        const highlight = document.createElement("div");
        highlight.id = "ocrHighlight";
        document.body.appendChild(highlight);
    }

    function showSavedPopup(){
        ensurePopupStyle();

        const popup = document.getElementById("scanSavedPopup");
        popup.classList.add("show");

        setTimeout(() => {
            popup.classList.remove("show");
        },700);
    }

    function normalizeSob(value){
        const text = String(value || "")
            .toUpperCase()
            .replace(/\s+/g,"");

        const match = text.match(/SOB0*([0-9]{6})(?![0-9])/);

        return match ? match[1] : "";
    }

    function handleDetectedSob(value,box){
        const sob = normalizeSob(value);

        if(!sob) return;

        if(box){
            const highlight = document.getElementById("ocrHighlight");

            highlight.style.display = "block";
            highlight.style.left = box.left + "px";
            highlight.style.top = box.top + "px";
            highlight.style.width = box.width + "px";
            highlight.style.height = box.height + "px";
        }

        sobInput.value = sob;
        showSavedPopup();

        stopOcr();

        setTimeout(() => {
            closeScanner();
            saveEntry();
        },220);
    }

    function loadTesseract(){
        return new Promise((resolve,reject) => {
            if(window.Tesseract){
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src = OCR_SCRIPT;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function prepareOcr(){
        ocrVideo = document.querySelector("#reader video");

        if(!ocrVideo){
            return false;
        }

        if(!ocrCanvas){
            ocrCanvas = document.createElement("canvas");
            ocrCanvas.style.display = "none";
            document.body.appendChild(ocrCanvas);
            ocrContext = ocrCanvas.getContext("2d",{
                willReadFrequently:true
            });
        }

        return true;
    }

    async function scanOcrFrame(){
        if(ocrBusy || !ocrVideo || ocrVideo.readyState < 2){
            return;
        }

        ocrBusy = true;

        try{
            const width = ocrVideo.videoWidth;
            const height = ocrVideo.videoHeight;

            if(!width || !height){
                ocrBusy = false;
                return;
            }

            ocrCanvas.width = width;
            ocrCanvas.height = height;

            ocrContext.drawImage(
                ocrVideo,
                0,
                0,
                width,
                height
            );

            const result = await Tesseract.recognize(
                ocrCanvas,
                "eng",
                {
                    logger:() => {}
                }
            );

            const words = result.data.words || [];

            for(const word of words){
                const text = word.text || "";
                const sob = normalizeSob(text);

                if(sob){
                    const rect = word.bbox || {};
                    const videoRect = ocrVideo.getBoundingClientRect();

                    const scaleX = videoRect.width / width;
                    const scaleY = videoRect.height / height;

                    handleDetectedSob(sob,{
                        left:videoRect.left + (rect.x0 || 0) * scaleX,
                        top:videoRect.top + (rect.y0 || 0) * scaleY,
                        width:((rect.x1 || 0) - (rect.x0 || 0)) * scaleX,
                        height:((rect.y1 || 0) - (rect.y0 || 0)) * scaleY
                    });

                    break;
                }
            }
        }catch(error){
            console.warn("OCR scan failed:",error);
        }

        ocrBusy = false;
    }

    async function startOcr(){
        try{
            await loadTesseract();

            if(!prepareOcr()){
                setTimeout(startOcr,800);
                return;
            }

            stopOcr();
            ocrTimer = setInterval(scanOcrFrame,1800);
        }catch(error){
            console.warn("OCR library could not load:",error);
        }
    }

    function stopOcr(){
        if(ocrTimer){
            clearInterval(ocrTimer);
            ocrTimer = null;
        }

        const highlight = document.getElementById("ocrHighlight");

        if(highlight){
            highlight.style.display = "none";
        }
    }

    const oldOnScanSuccess = window.onScanSuccess;

    window.onScanSuccess = function(decodedText){
        const sob = normalizeSob(decodedText);

        if(!sob){
            return;
        }

        handleDetectedSob(sob,null);
    };

    const oldStartScanner = window.startScanner;

    window.startScanner = function(){
        ensurePopupStyle();
        oldStartScanner();

        setTimeout(startOcr,1200);
    };

    originalCloseScanner = window.closeScanner;

    window.closeScanner = function(){
        stopOcr();
        originalCloseScanner();
    };

    const originalOnlineHandler = window.ononline;

    window.addEventListener("online",() => {
        setTimeout(window.syncOfflineQueue,500);
    });

    window.addEventListener("offline",() => {
        setCloudStatus("offline");
    });

    ensurePopupStyle();
    window.syncOfflineQueue();

})();
