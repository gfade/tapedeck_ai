Class {
	#name : 'TdAgentImageTest',
	#superclass : 'TdTestCase',
	#instVars : [ 'scratch', 'previousAgent' ],
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdAgentImageTest >> archiveWithFiles: files [

	^ OrderedDictionary new
		at: 'format' put: 'tapedeck.archive/v1';
		at: 'createdAt' put: '2026-09-26T00:00:00Z';
		at: 'files' put: files;
		at: 'gitBundles' put: #();
		yourself
]

{ #category : 'fixtures' }
TdAgentImageTest >> entryNamed: aName bytes: bytes [

	^ OrderedDictionary new
		at: 'path' put: aName;
		at: 'mode' put: 420;
		at: 'size' put: bytes size;
		at: 'sha256' put: (SHA256 hashMessage: bytes) hex;
		at: 'data' put: (Base64MimeConverter mimeEncode: bytes readStream multiLine: false) contents;
		yourself
]

{ #category : 'running' }
TdAgentImageTest >> setUp [

	super setUp.
	previousAgent := TdAgentImage current.
	scratch := FileLocator temp / ('tapedeck-image-' , UUID new asString)
]

{ #category : 'running' }
TdAgentImageTest >> tearDown [

	TdAgentImage current: previousAgent.
	scratch exists ifTrue: [ scratch ensureDeleteAll ].
	super tearDown
]

{ #category : 'tests' }
TdAgentImageTest >> testBinaryFilesRestoreWithoutOriginalDirectory [

	| agent bytes entry |
	bytes := #[ 0 1 2 127 128 254 255 ].
	entry := self entryNamed: 'snapshots/run-1/assets/data.bin' bytes: bytes.
	agent := TdAgentImage fromArchive: (self archiveWithFiles: { entry }).
	self assert: (agent fileBytesAt: (entry at: 'path')) equals: bytes.
	agent restoreFilesTo: scratch.
	self assert: ((scratch / (entry at: 'path')) binaryReadStreamDo: [ :stream | stream contents ]) equals: bytes.
	agent restoreFilesTo: scratch.
	self assert: agent lastRestoreDirectory equals: scratch fullName
]

{ #category : 'tests' }
TdAgentImageTest >> testRejectsCorruptAndDuplicateFiles [

	| entry |
	entry := self entryNamed: 'snapshots/run-1/file.txt' bytes: 'trace' utf8Encoded.
	self should: [ TdAgentImage fromArchive: (self archiveWithFiles: { entry. entry }) ] raise: Error.
	entry at: 'sha256' put: ('0' repeat: 64).
	self should: [ TdAgentImage fromArchive: (self archiveWithFiles: { entry }) ] raise: Error
]

{ #category : 'tests' }
TdAgentImageTest >> testRejectsUnsafePaths [

	#( '../escape' '/absolute' 'runs/../escape' 'runs//file' 'C:\escape' ) do: [ :name |
		self should: [ TdAgentImage fromArchive: (self archiveWithFiles: {
			self entryNamed: name bytes: 'bad' utf8Encoded }) ] raise: Error ].
	self deny: scratch exists
]

{ #category : 'tests' }
TdAgentImageTest >> testRestoreDoesNotOverwriteChangedFile [

	| agent |
	agent := TdAgentImage fromArchive: (self archiveWithFiles: {
		self entryNamed: 'runs/example/stderr.log' bytes: 'recorded' utf8Encoded }).
	(scratch / 'runs/example') ensureCreateDirectory.
	(scratch / 'runs/example/stderr.log') writeStreamDo: [ :stream | stream nextPutAll: 'local edit' ].
	self should: [ agent restoreFilesTo: scratch ] raise: Error.
	self assert: (scratch / 'runs/example/stderr.log') contents equals: 'local edit'
]

{ #category : 'tests' }
TdAgentImageTest >> testTraceObjectsRemainInsideAgent [

	| files agent runDirectory |
	files := OrderedCollection new.
	runDirectory := self baseline directory.
	#( 'run.json' 'session.jsonl' 'tape-report.json' 'verify.json' ) do: [ :name |
		| file |
		file := runDirectory / name.
		file exists ifTrue: [ files add: (self entryNamed: 'runs/' , self baseline id , '/' , name
			bytes: (file binaryReadStreamDo: [ :stream | stream contents ])) ] ].
	agent := TdAgentImage fromArchive: (self archiveWithFiles: files asArray).
	TdAgentImage current: agent.
	self assert: agent store size equals: 1.
	self assert: agent store runs first steps size equals: self baseline steps size.
	self assert: agent store runs first session entries size equals: self baseline session entries size.
	self assert: agent store runs first directory isNil.
	self assert: TdAgentImage current identicalTo: agent
]

{ #category : 'tests' }
TdAgentImageTest >> testArchiveKeepsReportsTapesComparisonsAndGitBytes [

	| agent data entry bundle |
	entry := self entryNamed: 'reports/example.json' bytes: (TdJson toString: self gateReport) utf8Encoded.
	data := self archiveWithFiles: {
		entry.
		self entryNamed: 'tapes/example.json' bytes: (TdJson toString: (TdTape fromRun: self baseline) asDictionary) utf8Encoded.
		self entryNamed: 'comparisons/example.json' bytes: '{"format":"tapedeck.comparison/v1"}' utf8Encoded }.
	bundle := self entryNamed: 'unused' bytes: 'bundle bytes' utf8Encoded.
	bundle at: 'task' put: 't01'.
	data at: 'gitBundles' put: { bundle }.
	agent := TdAgentImage fromArchive: data.
	self assert: agent store reports size equals: 1.
	self assert: agent store tapes size equals: 1.
	self assert: agent comparisons size equals: 1.
	agent restoreFilesTo: scratch.
	self assert: (scratch / 'git-bundles/t01.bundle') contents equals: 'bundle bytes'
]

{ #category : 'tests' }
TdAgentImageTest >> testImageEditedTapeIsIncludedWhenExportingArchive [

	| agent tape imported |
	agent := TdAgentImage fromArchive: (self archiveWithFiles: #()).
	tape := TdTape fromRun: self baseline.
	tape editToolCall: (self baseline stepAt: 4) tools first id command: './tasks test'.
	agent store registerTape: tape.
	imported := TdAgentImage fromArchive: agent archive.
	self assert: (imported store tapeNamed: tape id) edits size equals: 1
]
