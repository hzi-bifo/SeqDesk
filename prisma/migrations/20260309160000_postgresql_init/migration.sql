-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'RESEARCHER',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "researcherRole" TEXT,
    "institution" TEXT,
    "facilityName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "name" TEXT,
    "generatedByE2E" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numberOfSamples" INTEGER,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "billingAddress" TEXT,
    "platform" TEXT,
    "instrumentModel" TEXT,
    "librarySelection" TEXT,
    "libraryStrategy" TEXT,
    "librarySource" TEXT,
    "customFields" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Study" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alias" TEXT,
    "description" TEXT,
    "generatedByE2E" BOOLEAN NOT NULL DEFAULT false,
    "checklistType" TEXT,
    "studyMetadata" TEXT,
    "readyForSubmission" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" TIMESTAMP(3),
    "studyAccessionId" TEXT,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "testRegisteredAt" TIMESTAMP(3),
    "notes" TEXT,
    "notesEditedAt" TIMESTAMP(3),
    "notesEditedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sampleset" (
    "id" TEXT NOT NULL,
    "checklists" TEXT NOT NULL,
    "selectedFields" TEXT,
    "fieldOverrides" TEXT,
    "sampleType" INTEGER NOT NULL DEFAULT 1,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "Sampleset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "sampleAlias" TEXT,
    "sampleTitle" TEXT,
    "sampleDescription" TEXT,
    "scientificName" TEXT,
    "taxId" TEXT,
    "sampleAccessionNumber" TEXT,
    "biosampleNumber" TEXT,
    "checklistData" TEXT,
    "checklistUnits" TEXT,
    "customFields" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "studyId" TEXT,
    "preferredAssemblyId" TEXT,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Read" (
    "id" TEXT NOT NULL,
    "file1" TEXT,
    "file2" TEXT,
    "checksum1" TEXT,
    "checksum2" TEXT,
    "experimentAccessionNumber" TEXT,
    "runAccessionNumber" TEXT,
    "readCount1" INTEGER,
    "readCount2" INTEGER,
    "avgQuality1" DOUBLE PRECISION,
    "avgQuality2" DOUBLE PRECISION,
    "fastqcReport1" TEXT,
    "fastqcReport2" TEXT,
    "sampleId" TEXT NOT NULL,
    "sequencingRunId" TEXT,

    CONSTRAINT "Read_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequencingRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runName" TEXT,
    "platform" TEXT,
    "instrument" TEXT,
    "runDate" TIMESTAMP(3),
    "folderPath" TEXT,
    "q30Score" DOUBLE PRECISION,
    "clusterDensity" DOUBLE PRECISION,
    "passFilterPct" DOUBLE PRECISION,
    "totalReads" INTEGER,
    "totalBases" BIGINT,
    "multiQcReport" TEXT,
    "demuxStats" TEXT,
    "runParameters" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequencingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "assemblyName" TEXT,
    "assemblyFile" TEXT,
    "assemblyAccession" TEXT,
    "sampleId" TEXT NOT NULL,
    "createdByPipelineRunId" TEXT,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" TEXT NOT NULL,
    "binName" TEXT,
    "binAccession" TEXT,
    "binFile" TEXT,
    "completeness" DOUBLE PRECISION,
    "contamination" DOUBLE PRECISION,
    "sampleId" TEXT NOT NULL,
    "createdByPipelineRunId" TEXT,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineConfig" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" TEXT,
    "inputSampleIds" TEXT,
    "studyId" TEXT,
    "runFolder" TEXT,
    "queueJobId" TEXT,
    "progress" INTEGER,
    "currentStep" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastWeblogAt" TIMESTAMP(3),
    "lastTraceAt" TIMESTAMP(3),
    "statusSource" TEXT,
    "outputPath" TEXT,
    "errorPath" TEXT,
    "outputTail" TEXT,
    "errorTail" TEXT,
    "results" TEXT,
    "queueStatus" TEXT,
    "queueReason" TEXT,
    "queueUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRunStep" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outputPath" TEXT,
    "errorPath" TEXT,
    "outputTail" TEXT,
    "errorTail" TEXT,

    CONSTRAINT "PipelineRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRunEvent" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processName" TEXT,
    "stepId" TEXT,
    "status" TEXT,
    "message" TEXT,
    "payload" TEXT,
    "source" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineArtifact" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "path" TEXT NOT NULL,
    "checksum" TEXT,
    "size" BIGINT,
    "studyId" TEXT,
    "sampleId" TEXT,
    "pipelineRunId" TEXT,
    "producedByStepId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusNote" (
    "id" TEXT NOT NULL,
    "noteType" TEXT NOT NULL DEFAULT 'INTERNAL',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "StatusNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "siteName" TEXT NOT NULL DEFAULT 'SeqDesk',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1e40af',
    "contactEmail" TEXT,
    "helpText" TEXT,
    "enaUsername" TEXT,
    "enaPassword" TEXT,
    "enaTestMode" BOOLEAN NOT NULL DEFAULT true,
    "dataBasePath" TEXT,
    "postSubmissionInstructions" TEXT,
    "modulesConfig" TEXT,
    "extraSettings" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFormConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "schema" TEXT NOT NULL,
    "coreFieldConfig" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderFormConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "submissionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "xmlContent" TEXT,
    "response" TEXT,
    "accessionNumbers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoWorkspace" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seedVersion" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "lastUserMessageAt" TIMESTAMP(3),
    "lastAdminMessageAt" TIMESTAMP(3),
    "userReadAt" TIMESTAMP(3),
    "adminReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "studyId" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,

    CONSTRAINT "AdminInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Sampleset_orderId_key" ON "Sampleset"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_preferredAssemblyId_key" ON "Sample"("preferredAssemblyId");

-- CreateIndex
CREATE UNIQUE INDEX "SequencingRun_runId_key" ON "SequencingRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineConfig_pipelineId_key" ON "PipelineConfig"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRun_runNumber_key" ON "PipelineRun"("runNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRunStep_pipelineRunId_stepId_key" ON "PipelineRunStep"("pipelineRunId", "stepId");

-- CreateIndex
CREATE INDEX "PipelineRunEvent_pipelineRunId_occurredAt_idx" ON "PipelineRunEvent"("pipelineRunId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoWorkspace_tokenHash_key" ON "DemoWorkspace"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DemoWorkspace_userId_key" ON "DemoWorkspace"("userId");

-- CreateIndex
CREATE INDEX "DemoWorkspace_expiresAt_idx" ON "DemoWorkspace"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvite_code_key" ON "AdminInvite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvite_usedById_key" ON "AdminInvite"("usedById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_notesEditedById_fkey" FOREIGN KEY ("notesEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sampleset" ADD CONSTRAINT "Sampleset_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_preferredAssemblyId_fkey" FOREIGN KEY ("preferredAssemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Read" ADD CONSTRAINT "Read_sequencingRunId_fkey" FOREIGN KEY ("sequencingRunId") REFERENCES "SequencingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Read" ADD CONSTRAINT "Read_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_createdByPipelineRunId_fkey" FOREIGN KEY ("createdByPipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_createdByPipelineRunId_fkey" FOREIGN KEY ("createdByPipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRunStep" ADD CONSTRAINT "PipelineRunStep_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRunEvent" ADD CONSTRAINT "PipelineRunEvent_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineArtifact" ADD CONSTRAINT "PipelineArtifact_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusNote" ADD CONSTRAINT "StatusNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusNote" ADD CONSTRAINT "StatusNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoWorkspace" ADD CONSTRAINT "DemoWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminInvite" ADD CONSTRAINT "AdminInvite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminInvite" ADD CONSTRAINT "AdminInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

