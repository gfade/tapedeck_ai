"
I am a collection of runs imported from a runner store (INTERFACES.md §5.1): each runs/<id>/ directory becomes a TdRun, and reports/<name>.json are the gate reports. I answer the usual questions (runs of a task, baselines of a variant, forks of a run, failed runs, every tool call) and I keep the tapes edited in the image, which win over the tapes derived from runs.

	store := TdStore fromDirectory: '/abs/store'.
	store runsForTask: 't01'.
	store forksOf: (store runNamed: 'a1b2').
	store failedRuns.
	store allToolCalls.
	store refresh.

My collections are replaced, never changed in place, so a server process can read me while I refresh.
"
Class {
	#name : 'TdStore',
	#superclass : 'Object',
	#instVars : [
		'directory',
		'runs',
		'reports',
		'tapes',
		'problems'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdStore class >> fromDirectory: aDirectory [

	^ self new
		  setDirectory: aDirectory asFileReference;
		  import;
		  yourself
]

{ #category : 'instance creation' }
TdStore class >> withRuns: aCollectionOfRuns [

	^ self new
		  addRuns: aCollectionOfRuns;
		  yourself
]

{ #category : 'adding' }
TdStore >> addReport: aGateReportDictionary named: aName [

	reports := reports copy
		           at: aName put: aGateReportDictionary;
		           yourself.
	^ aGateReportDictionary
]

{ #category : 'adding' }
TdStore >> addRun: aRun [
	"Add aRun, replacing a run with the same id. Runs stay sorted by id, and ids sort by time."

	aRun store: self.
	runs := ((runs reject: [ :each | each id = aRun id ]) copyWith: aRun) sorted: [ :a :b |
		        a id asString <= b id asString ].
	^ aRun
]

{ #category : 'adding' }
TdStore >> addRuns: aCollectionOfRuns [

	aCollectionOfRuns do: [ :each | self addRun: each ]
]

{ #category : 'queries' }
TdStore >> allToolCalls [
	"Every recorded tool call of every run."

	^ self toolCalls
]

{ #category : 'queries' }
TdStore >> baselineForTask: aTask variant: aVariantName [
	"The latest recorded run of a variant on a task, or nil."

	^ ((self baselinesFor: aVariantName) select: [ :each | each task = aTask ])
		  ifEmpty: [ nil ]
		  ifNotEmpty: [ :candidates | candidates last ]
]

{ #category : 'queries' }
TdStore >> baselinesFor: aVariantName [
	"The recorded runs (not forks or replays) of a variant: the tapes to fork from."

	^ self recordedRuns select: [ :each | each variant = aVariantName ]
]

{ #category : 'queries' }
TdStore >> childrenOf: aRunOrId [
	"The forks and replays made from a run."

	| parentId |
	parentId := self idOf: aRunOrId.
	^ runs select: [ :each | each parentId = parentId ]
]

{ #category : 'accessing' }
TdStore >> directory [

	^ directory
]

{ #category : 'enumerating' }
TdStore >> do: aBlock [

	runs do: aBlock
]

{ #category : 'tapes' }
TdStore >> editedTapeNamed: anId [

	^ tapes at: anId ifAbsent: [ nil ]
]

{ #category : 'queries' }
TdStore >> failedRuns [

	^ runs select: [ :each | each failed ]
]

{ #category : 'tapes' }
TdStore >> forgetTape: anId [
	"Drop an edited tape; the derived tape is served again."

	| tape |
	tape := tapes at: anId ifAbsent: [ ^ nil ].
	tapes := tapes copy
		         removeKey: anId;
		         yourself.
	^ tape
]

{ #category : 'queries' }
TdStore >> forks [

	^ self runsOfKind: #fork
]

{ #category : 'queries' }
TdStore >> forksOf: aRunOrId [

	| parentId |
	parentId := self idOf: aRunOrId.
	^ self forks select: [ :each | each parentId = parentId ]
]

{ #category : 'private' }
TdStore >> idOf: aRunOrId [

	^ aRunOrId isString
		  ifTrue: [ aRunOrId ]
		  ifFalse: [ aRunOrId id ]
]

{ #category : 'importing' }
TdStore >> import [
	"Read every run and report from my directory, replacing the runs I hold. Edited tapes are kept."

	problems := OrderedDictionary new.
	runs := ((self runDirectories collect: [ :each | self readRunIn: each ]) reject: [ :each | each isNil ])
		        sorted: [ :a :b | a id asString <= b id asString ].
	self importReports
]

{ #category : 'importing' }
TdStore >> importReports [

	| reportsDirectory imported |
	directory ifNil: [ ^ self ].
	reportsDirectory := directory / 'reports'.
	imported := OrderedDictionary new.
	reportsDirectory exists ifTrue: [
		((reportsDirectory filesMatching: '*.json') sorted: [ :a :b | a basename <= b basename ]) do: [ :each |
			imported at: each basenameWithoutExtension put: (TdJson fromFile: each) ] ].
	reports := imported
]

{ #category : 'initialization' }
TdStore >> initialize [

	super initialize.
	runs := #(  ).
	reports := OrderedDictionary new.
	tapes := OrderedDictionary new.
	problems := OrderedDictionary new
]

{ #category : 'importing' }
TdStore >> readRunIn: aDirectory [
	"The run of a run directory, or nil (noted in problems) when it cannot be read, e.g. while the runner is still writing it."

	^ [
	  (TdRun fromDirectory: aDirectory)
		  store: self;
		  yourself ]
		  on: Error
		  do: [ :exception |
			  problems at: aDirectory basename put: exception messageText asString.
			  nil ]
]

{ #category : 'testing' }
TdStore >> isEmpty [

	^ runs isEmpty
]

{ #category : 'queries' }
TdStore >> passedRuns [

	^ runs select: [ :each | each passed ]
]

{ #category : 'printing' }
TdStore >> printOn: aStream [

	aStream
		nextPutAll: 'TdStore(';
		print: runs size;
		nextPutAll: ' runs'.
	directory ifNotNil: [ aStream nextPutAll: ' from ' , directory fullName ].
	aStream nextPut: $)
]

{ #category : 'queries' }
TdStore >> recordedRuns [
	"Ordinary recorded runs, neither forks nor replays."

	^ self runsOfKind: #run
]

{ #category : 'importing' }
TdStore >> refresh [
	"Import the runs that appeared since the last import, re-read the runs that were still running, and re-read the reports."

	directory ifNil: [ ^ self ].
	problems := OrderedDictionary new.
	self runDirectories do: [ :each |
		(self runWithId: each basename)
			ifNil: [ (self readRunIn: each) ifNotNil: [ :aRun | self addRun: aRun ] ]
			ifNotNil: [ :aRun | aRun isFinished ifFalse: [ aRun refresh ] ] ].
	self importReports
]

{ #category : 'tapes' }
TdStore >> registerTape: aTape [
	"Keep an edited tape under its id. It wins over the tape derived from a run with the same id."

	tapes := tapes copy
		         at: aTape id put: aTape;
		         yourself.
	^ aTape
]

{ #category : 'removing' }
TdStore >> removeRun: aRun [

	(runs includes: aRun) ifFalse: [ ^ nil ].
	runs := runs copyWithout: aRun.
	aRun store: nil.
	^ aRun
]

{ #category : 'queries' }
TdStore >> replays [

	^ self runsOfKind: #replay
]

{ #category : 'queries' }
TdStore >> replaysOf: aRunOrId [

	| parentId |
	parentId := self idOf: aRunOrId.
	^ self replays select: [ :each | each parentId = parentId ]
]

{ #category : 'accessing' }
TdStore >> problems [
	"Run directories that could not be read at the last import or refresh: name -> error message."

	^ problems
]

{ #category : 'accessing' }
TdStore >> reportNamed: aName [
	"A gate report (INTERFACES.md §5.4) as a dictionary, or nil."

	^ reports at: aName ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdStore >> reportNames [

	^ reports keys
]

{ #category : 'accessing' }
TdStore >> reports [
	"Report name -> gate report dictionary."

	^ reports
]

{ #category : 'queries' }
TdStore >> rerunsOf: aVariantName task: aTask [
	"The full recorded runs of a variant on a task."

	^ (self baselinesFor: aVariantName) select: [ :each | each task = aTask ]
]

{ #category : 'private' }
TdStore >> runDirectories [

	| runsDirectory |
	directory ifNil: [ ^ #(  ) ].
	runsDirectory := directory / 'runs'.
	runsDirectory exists ifFalse: [ ^ #(  ) ].
	^ (runsDirectory directories select: [ :each |
		   (each / 'run.json') exists or: [ (each / 'session.jsonl') exists ] ]) sorted: [ :a :b |
		  a basename <= b basename ]
]

{ #category : 'queries' }
TdStore >> runNamed: aString [
	"The run with this id; else the only run whose id ends with aString, or contains it."

	| matches |
	(self runWithId: aString) ifNotNil: [ :aRun | ^ aRun ].
	matches := runs select: [ :each | each id asString endsWith: aString ].
	matches size = 1 ifTrue: [ ^ matches first ].
	matches := runs select: [ :each | each id asString includesSubstring: aString ].
	^ matches size = 1
		  ifTrue: [ matches first ]
		  ifFalse: [ nil ]
]

{ #category : 'queries' }
TdStore >> runWithId: anId [

	^ runs detect: [ :each | each id = anId ] ifNone: [ nil ]
]

{ #category : 'accessing' }
TdStore >> runs [
	"The runs, oldest first."

	^ runs
]

{ #category : 'queries' }
TdStore >> runsForTask: aTask [

	^ runs select: [ :each | each task = aTask ]
]

{ #category : 'queries' }
TdStore >> runsForVariant: aVariantName [

	^ runs select: [ :each | each variant = aVariantName ]
]

{ #category : 'queries' }
TdStore >> runsOfKind: aSymbol [

	^ runs select: [ :each | each kind = aSymbol ]
]

{ #category : 'initialization' }
TdStore >> setDirectory: aDirectory [

	directory := aDirectory
]

{ #category : 'accessing' }
TdStore >> size [

	^ runs size
]

{ #category : 'queries' }
TdStore >> steps [

	^ runs flatCollect: [ :each | each steps ]
]

{ #category : 'tapes' }
TdStore >> tapeNamed: anId [
	"The edited tape registered under anId, else the tape derived from the run with that id (if pi-tape recorded it), else nil."

	(tapes at: anId ifAbsent: [ nil ]) ifNotNil: [ :aTape | ^ aTape ].
	^ (self runWithId: anId) ifNotNil: [ :aRun | aRun hasTape ifTrue: [ TdTape fromRun: aRun ] ]
]

{ #category : 'tapes' }
TdStore >> tapes [
	"Tape id -> edited tape."

	^ tapes
]

{ #category : 'queries' }
TdStore >> tasks [

	^ ((runs collect: [ :each | each task ]) reject: [ :each | each isNil ]) asSet asSortedCollection asArray
]

{ #category : 'queries' }
TdStore >> toolCalls [
	"So that a tool call, a step, a run and a store all answer their tool calls."

	^ runs flatCollect: [ :each | each toolCalls ]
]

{ #category : 'queries' }
TdStore >> variants [

	^ ((runs collect: [ :each | each variant ]) reject: [ :each | each isNil ]) asSet asSortedCollection
		  asArray
]
