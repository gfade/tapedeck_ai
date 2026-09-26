Class {
	#name : 'TdAgentImage',
	#superclass : 'Object',
	#instVars : [ 'archive', 'store', 'comparisons', 'autoRestoreFiles', 'lastRestoreDirectory', 'lastError' ],
	#classInstVars : [ 'current' ],
	#category : 'TapeDeck-Server',
	#package : 'TapeDeck-Server'
}

{ #category : 'instance creation' }
TdAgentImage class >> captureFrom: aRunnerClient [

	^ current := self new captureFrom: aRunnerClient
]

{ #category : 'accessing' }
TdAgentImage class >> current [

	^ current
]

{ #category : 'accessing' }
TdAgentImage class >> current: anAgentOrNil [

	current := anAgentOrNil
]

{ #category : 'instance creation' }
TdAgentImage class >> fromArchive: aDictionary [

	^ self new readArchive: aDictionary
]

{ #category : 'initialization' }
TdAgentImage class >> initialize [

	SessionManager default registerUserClassNamed: self name
]

{ #category : 'system startup' }
TdAgentImage class >> startUp: isResuming [

	(isResuming and: [ current notNil ]) ifTrue: [ current resume ]
]

{ #category : 'accessing' }
TdAgentImage >> archive [

	| files |
	archive ifNil: [ ^ nil ].
	files := (archive at: 'files') asOrderedCollection.
	store tapes keysAndValuesDo: [ :identifier :tape |
		| name bytes entry |
		name := self validatePath: 'tapes/' , identifier asString , '.json'.
		bytes := (TdJson toString: tape asDictionary) utf8Encoded.
		entry := OrderedDictionary new
			at: 'path' put: name;
			at: 'mode' put: 384;
			at: 'size' put: bytes size;
			at: 'sha256' put: (SHA256 hashMessage: bytes) hex;
			at: 'data' put: (Base64MimeConverter mimeEncode: bytes readStream multiLine: false) contents;
			yourself.
		files := files reject: [ :each | (each at: 'path') = name ].
		files add: entry ].
	archive at: 'files' put: files asArray.
	^ archive
]

{ #category : 'accessing' }
TdAgentImage >> autoRestoreFiles [

	^ autoRestoreFiles
]

{ #category : 'accessing' }
TdAgentImage >> autoRestoreFiles: aBoolean [

	autoRestoreFiles := aBoolean
]

{ #category : 'capturing' }
TdAgentImage >> captureFrom: aRunnerClient [

	| previousTapes updated |
	previousTapes := store tapes values copy.
	updated := self class fromArchive: (aRunnerClient getJson: #( 'agent' 'archive' )).
	previousTapes do: [ :each | updated store registerTape: each ].
	archive := updated archive.
	store := updated store.
	comparisons := updated comparisons.
	^ self
]

{ #category : 'comparing' }
TdAgentImage >> compareRun: aRunOrId variant: aVariant model: aModel [

	| result client |
	client := self runnerClient.
	result := client compareRun: aRunOrId variant: aVariant model: aModel.
	self captureFrom: client.
	^ result
]

{ #category : 'accessing' }
TdAgentImage >> comparisons [

	^ comparisons
]

{ #category : 'private' }
TdAgentImage >> decodedBytes: anEntry [

	| converter bytes |
	converter := Base64MimeConverter new
		mimeStream: (anEntry at: 'data') readStream;
		dataStream: (ReadWriteStream on: ByteArray new);
		yourself.
	bytes := converter mimeDecodeToByteArray contents.
	bytes size = (anEntry at: 'size') ifFalse: [ self error: 'Archive file size mismatch' ].
	(SHA256 hashMessage: bytes) hex = (anEntry at: 'sha256') ifFalse: [ self error: 'Archive checksum mismatch' ].
	^ bytes
]

{ #category : 'accessing' }
TdAgentImage >> defaultRestoreDirectory [

	^ (Smalltalk os environment at: 'TAPEDECK_RESTORE_DIRECTORY' ifAbsent: [
		Smalltalk imagePath asFileReference parent /
			(Smalltalk imagePath asFileReference basenameWithoutExtension , '.files') ]) asFileReference
]

{ #category : 'accessing' }
TdAgentImage >> fileBytesAt: aPath [

	^ self decodedBytes: (self fileEntryAt: aPath)
]

{ #category : 'git' }
TdAgentImage >> exportRun: aRunOrId branch: aBranch push: aBoolean [

	^ self runnerClient post: #( 'git' 'exports' ) json:
		(OrderedDictionary new
			at: 'runId' put: (aRunOrId isString ifTrue: [ aRunOrId ] ifFalse: [ aRunOrId id ]);
			at: 'branch' put: aBranch;
			at: 'push' put: aBoolean;
			yourself)
]

{ #category : 'git' }
TdAgentImage >> gitStatusForTask: aTask [

	^ self runnerClient getJson: { 'git'. aTask }
]

{ #category : 'private' }
TdAgentImage >> fileEntryAt: aPath [

	^ (archive at: 'files') detect: [ :each | (each at: 'path') = aPath ]
]

{ #category : 'accessing' }
TdAgentImage >> fileNames [

	^ (archive at: 'files') collect: [ :each | each at: 'path' ]
]

{ #category : 'accessing' }
TdAgentImage >> fileTextAt: aPath [

	^ (self fileBytesAt: aPath) utf8Decoded
]

{ #category : 'initialization' }
TdAgentImage >> initialize [

	super initialize.
	store := TdStore new.
	comparisons := OrderedDictionary new.
	autoRestoreFiles := true
]

{ #category : 'accessing' }
TdAgentImage >> lastError [

	^ lastError
]

{ #category : 'accessing' }
TdAgentImage >> lastRestoreDirectory [

	^ lastRestoreDirectory
]

{ #category : 'private' }
TdAgentImage >> optionalJsonAt: aPath [

	^ (self fileNames includes: aPath)
		ifTrue: [ TdJson fromString: (self fileTextAt: aPath) ]
		ifFalse: [ nil ]
]

{ #category : 'importing' }
TdAgentImage >> readArchive: aDictionary [

	| names previous |
	(aDictionary at: 'format') = 'tapedeck.archive/v1' ifFalse: [ self error: 'Unsupported agent archive' ].
	previous := archive.
	archive := aDictionary.
	[ self validatedPayloads ] on: Error do: [ :exception | archive := previous. exception pass ].
	store := TdStore new.
	comparisons := OrderedDictionary new.
	names := self fileNames.
	names do: [ :name |
		((name beginsWith: 'runs/') and: [ name endsWith: '/run.json' ]) ifTrue: [
			| info prefix session report |
			info := TdJson fromString: (self fileTextAt: name).
			prefix := name allButLast: 'run.json' size.
			session := (names includes: prefix , 'session.jsonl')
				ifTrue: [ TdSessionFile fromString: (self fileTextAt: prefix , 'session.jsonl') ]
				ifFalse: [ nil ].
			report := self optionalJsonAt: prefix , 'tape-report.json'.
			report ifNotNil: [ info at: 'report' put: report ].
			store addRun: (TdRun fromDictionary: info session: session) ].
		((name beginsWith: 'reports/') and: [ name endsWith: '.json' ]) ifTrue: [
			store addReport: (TdJson fromString: (self fileTextAt: name))
				named: name asFileReference basenameWithoutExtension ].
		((name beginsWith: 'comparisons/') and: [ name endsWith: '.json' ]) ifTrue: [
			comparisons at: name asFileReference basenameWithoutExtension
				put: (TdJson fromString: (self fileTextAt: name)) ].
		((name beginsWith: 'tapes/') and: [ name endsWith: '.json' ]) ifTrue: [
			| tape |
			tape := TdJson fromString: (self fileTextAt: name).
			(tape at: 'format' ifAbsent: [ nil ]) = 'tapedeck.tape/v1' ifTrue: [
				store registerTape: (TdTape fromDictionary: tape) ] ] ].
	lastError := nil.
	^ self
]

{ #category : 'connecting' }
TdAgentImage >> reconnect [

	^ self runnerClient health
]

{ #category : 'restoring' }
TdAgentImage >> restoreFilesTo: aDirectory [

	| root payloads |
	root := aDirectory asFileReference asAbsolute.
	payloads := self validatedPayloads.
	payloads keysAndValuesDo: [ :name :bytes |
		| target |
		target := root resolve: name.
		self validateDestination: target.
		target exists ifTrue: [
			(target isFile and: [ target binaryReadStreamDo: [ :stream | stream contents = bytes ] ])
				ifFalse: [ self error: 'Refusing to overwrite restored file: ' , target fullName ] ] ].
	payloads keysAndValuesDo: [ :name :bytes |
		| target |
		target := root resolve: name.
		target exists ifFalse: [
			target parent ensureCreateDirectory.
			target binaryWriteStreamDo: [ :stream | stream nextPutAll: bytes ] ] ].
	(archive at: 'files') do: [ :entry |
		| target mode |
		target := root resolve: (entry at: 'path').
		mode := entry at: 'mode' ifAbsent: [ 420 ].
		target permissions: (FileSystemPermission posixPermissions: (mode bitAnd: 8r777)) ].
	lastRestoreDirectory := root fullName.
	lastError := nil.
	^ root
]

{ #category : 'restoring' }
TdAgentImage >> restoreRunner [

	^ self runnerClient post: #( 'agent' 'restore' ) json:
		(OrderedDictionary new at: 'archive' put: self archive; yourself)
]

{ #category : 'system startup' }
TdAgentImage >> resume [

	autoRestoreFiles ifTrue: [
		[ self restoreFilesTo: self defaultRestoreDirectory ]
			on: Error
			do: [ :exception |
				lastError := exception messageText asString.
				Stdio stderr nextPutAll: 'Agent image restore failed: ' , lastError; lf; flush ] ]
]

{ #category : 'connecting' }
TdAgentImage >> runnerClient [

	^ TdRunnerClient new store: store; yourself
]

{ #category : 'saving' }
TdAgentImage >> saveAs: aPath [

	| stem |
	stem := aPath asString.
	(stem endsWith: '.image') ifTrue: [ stem := stem allButLast: 6 ].
	(stem , '.image') asFileReference exists ifTrue: [ self error: 'Image already exists: ' , stem ].
	self class current: self.
	self archive.
	Smalltalk garbageCollect.
	Smalltalk saveAs: stem
]

{ #category : 'accessing' }
TdAgentImage >> store [

	^ store
]

{ #category : 'private' }
TdAgentImage >> validateDestination: aFileReference [

	| ancestor |
	ancestor := aFileReference.
	[ ancestor isRoot ] whileFalse: [
		ancestor isSymlink ifTrue: [ self error: 'Refusing a symbolic link in restore destination' ].
		ancestor := ancestor parent ]
]

{ #category : 'private' }
TdAgentImage >> validatePath: aString [

	| segments |
	(aString isString and: [ aString isNotEmpty ]) ifFalse: [ self error: 'Invalid archive path' ].
	((aString includes: $\) or: [ (aString includes: $:) or: [ aString includes: Character null ] ])
		ifTrue: [ self error: 'Unsafe archive path' ].
	segments := aString splitOn: '/'.
	(segments anySatisfy: [ :segment | #( '' '.' '..' ) includes: segment ])
		ifTrue: [ self error: 'Unsafe archive path' ].
	^ aString
]

{ #category : 'private' }
TdAgentImage >> validatedPayloads [

	| result total |
	result := OrderedDictionary new.
	total := 0.
	(archive at: 'files') do: [ :entry |
		| name bytes |
		name := self validatePath: (entry at: 'path').
		(result includesKey: name) ifTrue: [ self error: 'Duplicate archive path' ].
		bytes := self decodedBytes: entry.
		total := total + bytes size.
		total > (512 * 1024 * 1024) ifTrue: [ self error: 'Embedded archive exceeds 512 MiB' ].
		result at: name put: bytes ].
	(archive at: 'gitBundles') do: [ :entry |
		| name bytes task |
		task := self validatePath: (entry at: 'task').
		(task includes: $/) ifTrue: [ self error: 'Invalid task in Git bundle' ].
		name := 'git-bundles/' , task , '.bundle'.
		(result includesKey: name) ifTrue: [ self error: 'Duplicate Git bundle' ].
		bytes := self decodedBytes: entry.
		total := total + bytes size.
		total > (512 * 1024 * 1024) ifTrue: [ self error: 'Embedded archive exceeds 512 MiB' ].
		result at: name put: bytes ].
	^ result
]
