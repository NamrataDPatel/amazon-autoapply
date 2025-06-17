require('dotenv').config();

const axios = require("axios");
console.log("📦 Background script loaded");

let hasOpenedGeneralQuestionsPage = false;
async function autoApply(AUTH_TOKEN, bbCandidateId) {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));


    const TARGET_LOCATIONS = [
        'brampton', 'hamilton', 'cambridge', 'scarborough', 'mississauga',
        'london', 'richmond hill', 'concord', 'oakville', "ottawa"
    ];

    async function searchJobsByLocation() {
        try {
            const res = await axios.post("https://e5mquma77feepi2bdn4d6h3mpu.appsync-api.us-east-1.amazonaws.com/graphql", {
                operationName: "searchJobCardsByLocation",
                query: `
          query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
            searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {
              jobCards {
                jobId
                city
                locationName
                jobTitle
              }
            }
          }
        `,
                variables: {
                    searchJobRequest: {
                        locale: "en-CA",
                        country: "CA"
                    }
                }
            }, {
                headers: {
                    Authorization: AUTH_TOKEN,
                    "Content-Type": "application/json"
                },
                withCredentials: true
            });
            return res.data?.data?.searchJobCardsByLocation?.jobCards || [];
        } catch (err) {
            console.error("❌ Job search error:", err.message);
            return [];
        }
    }

    async function fetchShifts(jobId) {
        try {
            const res = await axios.post("https://e5mquma77feepi2bdn4d6h3mpu.appsync-api.us-east-1.amazonaws.com/graphql", {
                operationName: "searchScheduleCards",
                query: `
          query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) {
            searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) {
              scheduleCards {
                scheduleId
                scheduleType
                state
                employmentType
              }
            }
          }
        `,
                variables: {
                    searchScheduleRequest: {
                        jobId,
                        locale: "en-CA",
                        country: "CA"
                    }
                }
            }, {
                headers: {
                    Authorization: AUTH_TOKEN,
                    "Content-Type": "application/json"
                },
                withCredentials: true
            });

            return (res.data?.data?.searchScheduleCards?.scheduleCards || [])
                .filter(s => s.scheduleType?.toUpperCase() !== "FLEX_TIME");
        } catch (err) {
            console.error(`❌ Shift fetch error for ${jobId}:`, err.message);
            return [];
        }
    }

    async function applyAndOpenTab(jobId, scheduleId, bbCandidateId, state, employmentType) {
        //  const cookieHeader = await getCookieHeader("hiring.amazon.ca");

        let applicationId;
        try {
            const createRes = await axios.post(
                "https://hiring.amazon.ca/application/api/candidate-application/ds/create-application/",
                {
                    candidateId: bbCandidateId,
                    dspEnabled: true,
                    scheduleId,
                    jobId,
                    activeApplicationCheckEnabled: true
                },
                {
                    headers: {
                        Authorization: AUTH_TOKEN,
                        "Content-Type": "application/json",
                        // Cookie: cookieHeader
                    },
                    withCredentials: true
                }
            );

            applicationId = createRes.data?.data?.applicationId;
            if (!applicationId) {
                console.warn("⚠️ No applicationId returned from create-application");
                return false;
            }
        } catch (err) {
            console.error("❌ Error creating application:", err.message);
            return false;
        }

        // Mark general questions complete and open tab
        markGeneralQuestionsComplete(
            AUTH_TOKEN,
            applicationId,
            bbCandidateId,
            jobId,
            scheduleId,
            {
                state,
                employmentType,
                requisitionId: "",
                jobSelectedOn: new Date().toISOString()
            }
        );
        try {
            const updateRes = await axios.put(
                "https://hiring.amazon.ca/application/api/candidate-application/update-application",
                {
                    applicationId,
                    dspEnabled: true,
                    payload: { jobId, scheduleId },
                    type: "job-confirm"
                },
                {
                    headers: {
                        Authorization: AUTH_TOKEN,
                        "Content-Type": "application/json"
                    },
                    withCredentials: true
                }
            );

            const updateData = updateRes.data;

            if (updateRes.status !== 200) {
                console.error(`❌ Update application failed with status ${updateRes.status}`);
                return false;
            }

            if (!updateData || updateData.error || (updateData.message && updateData.message.toLowerCase().includes("schedule not available"))) {
                console.warn("⚠️ Update failed or schedule not available:", updateData.message || updateData.error);
                return false;
            }
        } catch (err) {
            console.error("❌ Exception updating application:", err.message);
            return false;
        }

        if (hasOpenedGeneralQuestionsPage) {
            console.log("🛑 Already opened General Questions page, aborting.");
            return false;
        }


        try {
            await fetch(
                "https://hiring.amazon.ca/application/api/candidate-application/update-workflow-step-name",
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': AUTH_TOKEN,
                        'Content-Type': 'application/json',
                        // 'Cookie': cookieHeader
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        applicationId,
                        workflowStepName: "general-questions",
                    })
                }
            );
        } catch (err) {
            console.error("⚠️ Failed to update workflow step name:", err.message);
            return false;
        }

        hasOpenedGeneralQuestionsPage = true;

        const generalQuestionsUrl = `https://hiring.amazon.ca/application/ca/?CS=true&jobId=${jobId}&locale=en-CA&scheduleId=${scheduleId}&ssoEnabled=1#/general-questions?applicationId=${applicationId}`;

        
        console.log("✅ Open General Questions page in new tab:", generalQuestionsUrl);
       
        return true;
    }

    const jobs = await searchJobsByLocation();
    const filteredJobs = jobs.filter(job =>
        job.city && TARGET_LOCATIONS.includes(job.city.trim().toLowerCase())
    );

    if (filteredJobs.length === 0) {
        console.log("⚠️ No matching jobs found in target locations, retrying...");
        await sleep(50);
        if (!hasOpenedGeneralQuestionsPage) {
            return autoApply(AUTH_TOKEN, bbCandidateId);
        }
        return;
    }

    const selectedJob = filteredJobs[Math.floor(Math.random() * filteredJobs.length)];


    console.log(`✅ Selected job ${selectedJob.jobId} in ${selectedJob.city}`);

    const shifts = await fetchShifts(selectedJob.jobId);

    if (shifts.length === 0) {
        console.warn(`⚠️ No shifts found for job ${selectedJob.jobId}, retrying...`);
        await sleep(50);
        if (!hasOpenedGeneralQuestionsPage) {
            return autoApply(AUTH_TOKEN, bbCandidateId);
        }
        return;
    }

    const selectedShift = shifts.reduce((maxShift, currentShift) => {
        return (currentShift.laborDemandAvailableCount || 0) > (maxShift.laborDemandAvailableCount || 0)
            ? currentShift
            : maxShift;
    }, shifts[0]);
    const state = selectedShift.state || "";
    const employmentType = selectedShift.employmentType || "";


    console.log(`✅ Selected shift ${selectedShift.scheduleId} with laborDemandAvailableCount=${selectedShift.laborDemandAvailableCount} for job ${selectedJob.jobId}`);


    const success = await applyAndOpenTab(selectedJob.jobId, selectedShift.scheduleId, bbCandidateId, state, employmentType);
    if (!success) {
        console.warn("🔁 Application attempt failed, retrying...");
        await sleep(100);
        if (!hasOpenedGeneralQuestionsPage) {
            return autoApply(AUTH_TOKEN, bbCandidateId);
        }
    }

    if (hasOpenedGeneralQuestionsPage) {
        console.log("🛑 Stopping further automation – General Questions page opened.");
        return;
    }
}
function markGeneralQuestionsComplete(authToken, applicationId, bbCandidateId, jobId, scheduleId, jobMeta) {
    const wsUrl = `wss://ufatez9oyf.execute-api.us-east-1.amazonaws.com/prod?applicationId=${applicationId}&candidateId=${bbCandidateId}&authToken=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("🟢 WS connected: Starting workflow at job-opportunities");
        const startWorkflowPayload = {
            action: "startWorkflow",
            applicationId,
            candidateId: bbCandidateId,
            jobId,
            scheduleId,
            partitionAttributes: { countryCodes: ["CA"] },
            filteringSeasonal: false,
            filteringRegular: false,
            domainType: "CS"
        };
        ws.send(JSON.stringify(startWorkflowPayload));
    };

    let hasSentGeneralQuestionsWorkflow = false;

    ws.onmessage = (event) => {
        console.log("📨 WS response:", event.data);
        try {
            const data = JSON.parse(event.data);

            if (data.stepName === "job-opportunities") {
                const completeTaskPayload = {
                    action: "completeTask",
                    applicationId,
                    candidateId: bbCandidateId,
                    requisitionId: jobMeta.requisitionId || "",
                    jobId,
                    domainType: "CS",
                    state: jobMeta.state || "",
                    employmentType: jobMeta.employmentType || "",
                    eventSource: jobMeta.eventSource || "HVH-CA-UI",
                    jobSelectedOn: jobMeta.jobSelectedOn || new Date().toISOString(),
                    currentWorkflowStep: "job-opportunities",
                    workflowStepName: "",
                    partitionAttributes: { countryCodes: ["CA"] },
                    filteringSeasonal: false,
                    filteringRegular: false
                };
                ws.send(JSON.stringify(completeTaskPayload));
            }

            if (data.stepName === "general-questions" && !hasSentGeneralQuestionsWorkflow) {
                hasSentGeneralQuestionsWorkflow = true;
                console.log("✅ Moved to general-questions step. Sending startWorkflow again...");
            }

        } catch (err) {
            console.error("❌ WS message parse error:", err);
        }
    };

    ws.onerror = (err) => {
        console.error("❌ WS error:", err);
    };
}

// Run automatically
(async () => {
    const AUTH_TOKEN = process.env.AUTH_TOKEN;
    const bbCandidateId = process.env.BB_CANDIDATE_ID;

    if (!AUTH_TOKEN || !bbCandidateId) {
        console.error("❌ Missing environment variables");
        return;
    }
    setInterval(() => {
        autoApply(AUTH_TOKEN, bbCandidateId);
    }, 100);
})();
