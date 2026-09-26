"
I am one run: one pi process working on one task with one harness variant (INTERFACES.md §1). I am imported from a runner store directory (run.json, session.jsonl, tape-report.json, verify.json) or from a bare session file, and I hold my steps, verdict, usage, divergence and the harness state of every step.

	run := TdRun fromDirectory: '/abs/store/runs/<id>'.
	run steps.
	(run stepAt: 4) tools first command.
	run harnessStateAt: 3.
	run divergence.
	TdRun fromSessionFile: '/path/to/any/pi/session.jsonl'.

kind is #run (a recorded run), #fork or #replay. usage counts what the run spent live; savedUsage is the recorded usage of its replayed steps (tokens not spent again). pass is true, false, or nil when there is no verdict (replays).
"
Class {
	#name : 'TdRun',
	#superclass : 'Object',
	#instVars : [
		'id',
		'task',
		'split',
		'variant',
		'model',
		'kind',
		'parentId',
		'forkAt',
		'lenient',
		'tapeSource',
		'status',
		'error',
		'pass',
		'verify',
		'usage',
		'savedUsage',
		'divergence',
		'startedAt',
		'finishedAt',
		'durationMs',
		'steps',
		'header',
		'report',
		'session',
		'info',
		'directory',
		'store'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdRun class >> fromDictionary: aRunDictionary session: aSessionFileOrNil [
	"A run as the runner's HTTP API answers it (run.json, possibly with its tape report under report), with its session."

	^ self new importInfo: aRunDictionary session: aSessionFileOrNil
]

{ #category : 'instance creation' }
TdRun class >> fromDirectory: aDirectory [
	"A run directory of a runner store: runs/<id>/ (INTERFACES.md §5.1)."

	^ self new importDirectory: aDirectory asFileReference
]

{ #category : 'instance creation' }
TdRun class >> fromSession: aSessionFile id: anId [

	^ self new importSession: aSessionFile id: anId
]

{ #category : 'instance creation' }
TdRun class >> fromSessionFile: aFileReferenceOrPath [
	"Any pi session file, with or without pi-tape entries. The id is the file name."

	| file |
	file := aFileReferenceOrPath asFileReference.
	^ self fromSession: (TdSessionFile fromFile: file) id: file basenameWithoutExtension
]

{ #category : 'private' }
TdRun >> applyEntry: anEntry to: aHarnessState [
	"Apply a session entry that changes the harness: a system message, or a compaction's checkpoint."

	| type message |
	type := anEntry at: 'type' ifAbsent: [ nil ].
	type = 'compaction' ifTrue: [
		^ (anEntry at: 'systemMessage' ifAbsent: [ nil ]) ifNotNil: [ :checkpoint |
			  aHarnessState applyCheckpoint: (self normalizedMessage: checkpoint) ] ].
	type = 'message' ifFalse: [ ^ self ].
	message := anEntry at: 'message' ifAbsent: [ nil ].
	(message isDictionary and: [ (message at: 'role' ifAbsent: [ nil ]) = 'system' ]) ifTrue: [
		aHarnessState apply: (self normalizedMessage: message) ]
]

{ #category : 'accessing' }
TdRun >> cost [
	"Dollars spent live."

	^ usage cost
]

{ #category : 'accessing' }
TdRun >> cwd [
	"The working directory of the recording (its worktree)."

	^ (header ifNotNil: [ header at: 'cwd' ifAbsent: [ nil ] ]) ifNil: [
		  session ifNotNil: [ session cwd ] ]
]

{ #category : 'private' }
TdRun >> deriveFromSteps [
	"Defaults for a session without run.json: usage of live and replayed steps, model of the first response."

	usage := self usageOfSteps: self liveSteps.
	savedUsage := self usageOfSteps: self replayedSteps.
	(model isNil and: [ steps notEmpty and: [ steps first response notNil ] ]) ifTrue: [
		model := self modelNameOf: steps first response ]
]

{ #category : 'printing' }
TdRun >> description [

	^ String streamContents: [ :out |
		  out
			  nextPutAll: (task ifNil: [ '?' ]) asString;
			  space;
			  nextPutAll: (variant ifNil: [ '?' ]) asString;
			  space;
			  nextPutAll: kind asString;
			  space;
			  nextPutAll: self verdictString;
			  nextPutAll: ', ';
			  print: self stepCount;
			  nextPutAll: ' steps, ';
			  print: usage ]
]

{ #category : 'accessing' }
TdRun >> directory [
	"The run directory I was imported from, or nil."

	^ directory
]

{ #category : 'accessing' }
TdRun >> divergence [
	"Where a replay or fork left its tape (a TdDivergence), or nil."

	^ divergence
]

{ #category : 'accessing' }
TdRun >> durationMs [

	^ durationMs
]

{ #category : 'accessing' }
TdRun >> error [
	"The runner's error message for a run that failed to run, or nil."

	^ error
]

{ #category : 'testing' }
TdRun >> failed [

	^ pass == false
]

{ #category : 'accessing' }
TdRun >> finalHarnessState [

	^ steps isEmpty
		  ifTrue: [ TdHarnessState new ]
		  ifFalse: [ steps last harnessState ]
]

{ #category : 'accessing' }
TdRun >> finishedAt [

	^ finishedAt
]

{ #category : 'queries' }
TdRun >> firstStepSuchThat: aBlock [

	^ steps detect: aBlock ifNone: [ nil ]
]

{ #category : 'accessing' }
TdRun >> forkAt [
	"The step a fork was forced to go live at (PI_TAPE_FORK_AT), or nil."

	^ forkAt
]

{ #category : 'accessing' }
TdRun >> forks [
	"The forks of me in my store."

	^ store
		  ifNil: [ #(  ) ]
		  ifNotNil: [ store forksOf: self ]
]

{ #category : 'harness' }
TdRun >> harnessChanges [
	"How the harness changed during the run, from the first to the last step."

	^ self initialHarnessState diff: self finalHarnessState
]

{ #category : 'harness' }
TdRun >> harnessDiff [
	"Against my parent's first harness when my parent is in my store (a fork or replay: what the variant changed), else the changes during the run."

	^ self harnessDiffFromParent ifNil: [ self harnessChanges ]
]

{ #category : 'harness' }
TdRun >> harnessDiffFromParent [
	"What my variant changed in the harness compared to the run I was forked or replayed from, or nil."

	^ self parent ifNotNil: [ :aParent | aParent initialHarnessState diff: self initialHarnessState ]
]

{ #category : 'harness' }
TdRun >> harnessStateAt: aStepIndex [
	"The harness the model saw in the request of this step, or nil if there is no such step."

	^ (self stepAt: aStepIndex) ifNotNil: [ :aStep | aStep harnessState ]
]

{ #category : 'harness' }
TdRun >> harnessStateBeforeEntry: anEntryId [
	"Replay the session's system messages (and compaction checkpoints) up to the given entry, writing my working directory as <cwd> like pi-tape's normalized requests. Used for steps without a recorded request."

	| state |
	state := TdHarnessState new.
	session ifNil: [ ^ state ].
	session activeBranch do: [ :entry |
		(entry at: 'id' ifAbsent: [ nil ]) = anEntryId ifTrue: [ ^ state ].
		self applyEntry: entry to: state ].
	^ state
]

{ #category : 'testing' }
TdRun >> hasTape [
	"Whether pi-tape recorded me, so that I can be replayed or forked."

	^ header notNil or: [ session notNil and: [ session hasTape ] ]
]

{ #category : 'testing' }
TdRun >> hasVerdict [

	^ pass notNil
]

{ #category : 'accessing' }
TdRun >> header [
	"The data of pi-tape's tape.header entry, or nil."

	^ header
]

{ #category : 'accessing' }
TdRun >> id [

	^ id
]

{ #category : 'importing' }
TdRun >> importDirectory: aDirectory [

	directory := aDirectory.
	id := aDirectory basename.
	(aDirectory / 'session.jsonl') exists ifTrue: [
		self readSession: (TdSessionFile fromFile: aDirectory / 'session.jsonl') ].
	(aDirectory / 'tape-report.json') exists ifTrue: [
		self readReport: (TdJson fromFile: aDirectory / 'tape-report.json') ].
	(aDirectory / 'run.json') exists ifTrue: [ self readInfo: (TdJson fromFile: aDirectory / 'run.json') ].
	(verify isNil and: [ (aDirectory / 'verify.json') exists ]) ifTrue: [
		self readVerify: (TdJson fromFile: aDirectory / 'verify.json') ]
]

{ #category : 'importing' }
TdRun >> importInfo: aRunDictionary session: aSessionFileOrNil [

	aSessionFileOrNil ifNotNil: [ :aSession | self readSession: aSession ].
	(aRunDictionary at: 'report' ifAbsent: [ nil ]) ifNotNil: [ :aReport | self readReport: aReport ].
	self readInfo: aRunDictionary
]

{ #category : 'importing' }
TdRun >> importSession: aSessionFile id: anId [

	id := anId.
	self readSession: aSessionFile
]

{ #category : 'accessing' }
TdRun >> info [
	"run.json as read, or nil."

	^ info
]

{ #category : 'accessing' }
TdRun >> initialHarnessState [

	^ steps isEmpty
		  ifTrue: [ TdHarnessState new ]
		  ifFalse: [ steps first harnessState ]
]

{ #category : 'initialization' }
TdRun >> initialize [

	super initialize.
	kind := #run.
	lenient := #(  ).
	steps := #(  ).
	usage := TdUsage zero.
	savedUsage := TdUsage zero
]

{ #category : 'testing' }
TdRun >> isFinished [
	"The runner no longer works on me."

	^ status ~= 'running'
]

{ #category : 'testing' }
TdRun >> isFork [

	^ kind = #fork
]

{ #category : 'testing' }
TdRun >> isRecorded [
	"An ordinary recorded run (not a fork or a replay)."

	^ kind = #run
]

{ #category : 'testing' }
TdRun >> isReplay [

	^ kind = #replay
]

{ #category : 'private' }
TdRun >> kindForMode: aModeOrNil [
	"pi-tape's header mode -> my kind."

	aModeOrNil = 'fork' ifTrue: [ ^ #fork ].
	aModeOrNil = 'replay' ifTrue: [ ^ #replay ].
	^ #run
]

{ #category : 'accessing' }
TdRun >> kind [
	"#run, #fork or #replay."

	^ kind
]

{ #category : 'accessing' }
TdRun >> lenient [
	"What the fork ignored before going live, e.g. #('system')."

	^ lenient
]

{ #category : 'queries' }
TdRun >> liveSteps [

	^ steps select: [ :each | each isLive ]
]

{ #category : 'accessing' }
TdRun >> model [
	"provider/modelId of the upstream model."

	^ model
]

{ #category : 'private' }
TdRun >> modelNameOf: aResponse [
	"provider/model of a recorded response."

	aResponse model ifNil: [ ^ nil ].
	aResponse provider ifNil: [ ^ aResponse model asString ].
	^ aResponse provider asString , '/' , aResponse model asString
]

{ #category : 'accessing' }
TdRun >> name [

	^ id
]

{ #category : 'harness' }
TdRun >> normalizeCwdIn: aJsonValue [
	"A copy with my working directory written as <cwd>, as pi-tape writes it in normalized requests."

	^ TdJson replace: self cwd with: '<cwd>' in: aJsonValue
]

{ #category : 'private' }
TdRun >> normalizedMessage: aDictionary [

	^ TdMessage fromDictionary: (self normalizeCwdIn: aDictionary)
]

{ #category : 'accessing' }
TdRun >> parent [
	"The run I was forked or replayed from, when it is in my store."

	parentId ifNil: [ ^ nil ].
	^ store ifNotNil: [ store runWithId: parentId ]
]

{ #category : 'accessing' }
TdRun >> parentId [

	^ parentId
]

{ #category : 'accessing' }
TdRun >> pass [
	"The verifier's verdict: true, false, or nil (no verdict, e.g. a replay)."

	^ pass
]

{ #category : 'testing' }
TdRun >> passed [

	^ pass == true
]

{ #category : 'printing' }
TdRun >> printOn: aStream [

	aStream
		nextPutAll: 'TdRun(';
		nextPutAll: id asString;
		nextPut: $)
]

{ #category : 'importing' }
TdRun >> readHeader [
	"Defaults from pi-tape's tape.header; run.json, when present, overrides them."

	header ifNil: [ ^ self ].
	variant := header at: 'label' ifAbsent: [ variant ].
	kind := self kindForMode: (header at: 'mode' ifAbsent: [ nil ]).
	forkAt := header at: 'forkAt' ifAbsent: [ forkAt ].
	lenient := (header at: 'lenient' ifAbsent: [ nil ]) ifNil: [ #(  ) ].
	(header at: 'upstream' ifAbsent: [ nil ]) ifNotNil: [ :upstream |
		upstream isDictionary ifTrue: [
			model := (upstream at: 'provider' ifAbsent: [ '?' ]) asString , '/'
			         , (upstream at: 'model' ifAbsent: [ '?' ]) asString ] ]
]

{ #category : 'importing' }
TdRun >> readInfo: aDictionary [
	"run.json (INTERFACES.md §5.2) is authoritative: its fields, null included, override what the session said."

	info := aDictionary.
	id := aDictionary at: 'id' ifAbsent: [ id ].
	kind := (aDictionary at: 'kind' ifAbsent: [ kind ]) ifNotNil: [ :value | value asSymbol ].
	task := aDictionary at: 'task' ifAbsent: [ task ].
	split := aDictionary at: 'split' ifAbsent: [ split ].
	variant := aDictionary at: 'variant' ifAbsent: [ variant ].
	model := aDictionary at: 'model' ifAbsent: [ model ].
	parentId := aDictionary at: 'parent' ifAbsent: [ parentId ].
	forkAt := aDictionary at: 'forkAt' ifAbsent: [ forkAt ].
	lenient := (aDictionary at: 'lenient' ifAbsent: [ lenient ]) ifNil: [ #(  ) ].
	tapeSource := aDictionary at: 'tapeSource' ifAbsent: [ tapeSource ].
	status := aDictionary at: 'status' ifAbsent: [ status ].
	error := aDictionary at: 'error' ifAbsent: [ error ].
	pass := aDictionary at: 'pass' ifAbsent: [ pass ].
	verify := aDictionary at: 'verify' ifAbsent: [ verify ].
	durationMs := aDictionary at: 'durationMs' ifAbsent: [ durationMs ].
	startedAt := self timestampAt: 'startedAt' in: aDictionary ifAbsent: [ startedAt ].
	finishedAt := self timestampAt: 'finishedAt' in: aDictionary ifAbsent: [ finishedAt ].
	(aDictionary includesKey: 'usage') ifTrue: [
		usage := TdUsage fromDictionary: (aDictionary at: 'usage') ].
	(aDictionary includesKey: 'savedUsage') ifTrue: [
		savedUsage := TdUsage fromDictionary: (aDictionary at: 'savedUsage') ].
	(aDictionary includesKey: 'divergence') ifTrue: [
		divergence := TdDivergence fromDictionary: (aDictionary at: 'divergence') ]
]

{ #category : 'importing' }
TdRun >> readReport: aDictionary [
	"pi-tape's report (INTERFACES.md §2.7): divergence, live and replayed usage."

	| reportUsage |
	report := aDictionary.
	(aDictionary at: 'divergence' ifAbsent: [ nil ]) ifNotNil: [ :data |
		divergence := TdDivergence fromDictionary: data ].
	reportUsage := aDictionary at: 'usage' ifAbsent: [ nil ].
	reportUsage isDictionary ifTrue: [
		usage := TdUsage fromDictionary: (reportUsage at: 'live' ifAbsent: [ nil ]).
		savedUsage := TdUsage fromDictionary: (reportUsage at: 'replayed' ifAbsent: [ nil ]) ].
	variant ifNil: [ variant := aDictionary at: 'label' ifAbsent: [ nil ] ]
]

{ #category : 'importing' }
TdRun >> readSession: aSessionFile [

	session := aSessionFile.
	header := aSessionFile tapeHeader.
	steps := (TdStepReader on: aSessionFile) steps.
	steps do: [ :each | each run: self ].
	self readHeader.
	self deriveFromSteps.
	divergence := TdDivergence fromDictionary: aSessionFile tapeDivergence.
	aSessionFile tapeReport ifNotNil: [ :aReport | self readReport: aReport ]
]

{ #category : 'importing' }
TdRun >> readVerify: aDictionary [

	verify := aDictionary.
	pass ifNil: [ pass := aDictionary at: 'pass' ifAbsent: [ nil ] ]
]

{ #category : 'accessing' }
TdRun >> recordedUsage [
	"The usage recorded for all my steps, replayed ones included (their cost is 0)."

	^ self usageOfSteps: steps
]

{ #category : 'importing' }
TdRun >> refresh [
	"Read me again from my directory, for a run that was still running."

	directory ifNil: [ ^ self ].
	self importDirectory: directory
]

{ #category : 'queries' }
TdRun >> replayedSteps [

	^ steps select: [ :each | each isReplayed ]
]

{ #category : 'accessing' }
TdRun >> report [
	"pi-tape's report (tape-report.json), or nil."

	^ report
]

{ #category : 'accessing' }
TdRun >> savedUsage [
	"The recorded usage of the replayed steps: what this run did not spend again."

	^ savedUsage
]

{ #category : 'accessing' }
TdRun >> session [
	"The TdSessionFile, or nil."

	^ session
]

{ #category : 'accessing' }
TdRun >> sessionId [

	^ session ifNotNil: [ session sessionId ]
]

{ #category : 'accessing' }
TdRun >> sessionPath [
	"The full path of the session file, or nil."

	^ session ifNotNil: [ session location ifNotNil: [ :file | file fullName ] ]
]

{ #category : 'accessing' }
TdRun >> snapshotBase [
	"The snapshot of the workspace before any tool ran."

	^ (header ifNotNil: [ header at: 'snapshotBase' ifAbsent: [ nil ] ]) ifNil: [
		  info ifNotNil: [ info at: 'snapshotBase' ifAbsent: [ nil ] ] ]
]

{ #category : 'accessing' }
TdRun >> split [
	"'held-in' or 'held-out'."

	^ split
]

{ #category : 'accessing' }
TdRun >> startedAt [

	^ startedAt
]

{ #category : 'accessing' }
TdRun >> status [
	"'running', 'done' or 'error' (from run.json)."

	^ status
]

{ #category : 'queries' }
TdRun >> stepAt: anInteger [

	^ steps detect: [ :each | each index = anInteger ] ifNone: [ nil ]
]

{ #category : 'queries' }
TdRun >> stepCount [

	^ steps size
]

{ #category : 'accessing' }
TdRun >> steps [

	^ steps
]

{ #category : 'accessing' }
TdRun >> store [

	^ store
]

{ #category : 'accessing' }
TdRun >> store: aStore [

	store := aStore
]

{ #category : 'accessing' }
TdRun >> tapeSource [
	"For a replay or fork: where its tape came from."

	^ tapeSource
]

{ #category : 'accessing' }
TdRun >> task [

	^ task
]

{ #category : 'private' }
TdRun >> timestampAt: aKey in: aDictionary ifAbsent: aBlock [

	| text |
	(aDictionary includesKey: aKey) ifFalse: [ ^ aBlock value ].
	text := aDictionary at: aKey.
	text isString ifFalse: [ ^ nil ].
	^ [ DateAndTime fromString: text ]
		  on: Error
		  do: [ nil ]
]

{ #category : 'accessing' }
TdRun >> tokens [
	"Tokens spent live."

	^ usage totalTokens
]

{ #category : 'queries' }
TdRun >> toolCalls [
	"Every tool call of every step, in order."

	^ steps flatCollect: [ :each | each tools ]
]

{ #category : 'accessing' }
TdRun >> upstream [
	"The upstream model of the recording, {provider, model}, or nil."

	^ header ifNotNil: [ header at: 'upstream' ifAbsent: [ nil ] ]
]

{ #category : 'accessing' }
TdRun >> usage [
	"What this run spent live."

	^ usage
]

{ #category : 'private' }
TdRun >> usageOfSteps: aCollection [

	^ TdUsage sumOf: (aCollection collect: [ :each | each usage ])
]

{ #category : 'accessing' }
TdRun >> variant [

	^ variant
]

{ #category : 'printing' }
TdRun >> verdictString [

	pass == true ifTrue: [ ^ 'pass' ].
	pass == false ifTrue: [ ^ 'fail' ].
	^ '-'
]

{ #category : 'accessing' }
TdRun >> verify [
	"verify.json: exitCode, pass, output, durationMs; or nil."

	^ verify
]
