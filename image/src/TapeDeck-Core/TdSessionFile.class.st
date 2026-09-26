"
I am a pi session file (JSON Lines in pi's v3 format, INTERFACES.md §3) read into dictionaries: the header line, the entries, an index from id to entry, and the active branch (start at the last entry and follow parentId to the root). I also give quick access to the custom entries pi-tape writes (tape.header, tape.step, tape.divergence, tape.report).

	session := TdSessionFile fromFile: '/abs/store/runs/<id>/session.jsonl'.
	session activeBranch.
	session customEntriesOfType: 'tape.step'.
	session entryAt: 'b963bdb2'.

A line that is not valid JSON (for example the last line of a crashed run) is skipped and counted in skippedLines.
"
Class {
	#name : 'TdSessionFile',
	#superclass : 'Object',
	#instVars : [
		'header',
		'entries',
		'entriesById',
		'activeBranch',
		'toolResultsById',
		'location',
		'skippedLines'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdSessionFile class >> fromEntries: aCollectionOfDictionaries [
	"The header line (type session) and the entries, as parsed JSON objects."

	^ self new setEntries: aCollectionOfDictionaries
]

{ #category : 'instance creation' }
TdSessionFile class >> fromFile: aFileReferenceOrPath [

	| file |
	file := aFileReferenceOrPath asFileReference.
	^ (self fromString: file contents) setLocation: file
]

{ #category : 'instance creation' }
TdSessionFile class >> fromString: aJsonLinesString [

	^ self new readLines: aJsonLinesString lines
]

{ #category : 'accessing' }
TdSessionFile >> activeBranch [
	"The entries from the root to the last entry of the file, following parentId."

	^ activeBranch ifNil: [ activeBranch := self branchEndingAt: self lastEntry ]
]

{ #category : 'accessing' }
TdSessionFile >> branchEndingAt: anEntryOrNil [
	"The entries from the root to anEntryOrNil, following parentId."

	| path seen current |
	path := OrderedCollection new.
	seen := IdentitySet new.
	current := anEntryOrNil.
	[ current notNil and: [ (seen includes: current) not ] ] whileTrue: [
		seen add: current.
		path addFirst: current.
		current := self parentOf: current ].
	^ path asArray
]

{ #category : 'accessing' }
TdSessionFile >> customDataOfType: aString [
	"The data of the custom entries of this customType on the active branch."

	^ (self customEntriesOfType: aString) collect: [ :each | each at: 'data' ifAbsent: [ nil ] ]
]

{ #category : 'accessing' }
TdSessionFile >> customEntriesOfType: aString [
	"The custom entries of this customType on the active branch, in order."

	^ (self entriesOfType: 'custom') select: [ :each |
		  (each at: 'customType' ifAbsent: [ nil ]) = aString ]
]

{ #category : 'accessing' }
TdSessionFile >> cwd [
	"The working directory pi ran in."

	^ header ifNotNil: [ header at: 'cwd' ifAbsent: [ nil ] ]
]

{ #category : 'accessing' }
TdSessionFile >> entries [
	"Every entry of the file (all branches), in file order, without the header."

	^ entries
]

{ #category : 'accessing' }
TdSessionFile >> entriesOfType: aString [
	"The entries of this type on the active branch."

	^ self activeBranch select: [ :each | (each at: 'type' ifAbsent: [ nil ]) = aString ]
]

{ #category : 'accessing' }
TdSessionFile >> entryAt: anId [

	^ entriesById at: anId ifAbsent: [ nil ]
]

{ #category : 'testing' }
TdSessionFile >> hasTape [
	"Whether pi-tape recorded steps in this session."

	^ self tapeSteps notEmpty
]

{ #category : 'accessing' }
TdSessionFile >> header [
	"The first line (type session): version, id, timestamp, cwd."

	^ header
]

{ #category : 'accessing' }
TdSessionFile >> lastEntry [

	^ entries isEmpty
		  ifTrue: [ nil ]
		  ifFalse: [ entries last ]
]

{ #category : 'accessing' }
TdSessionFile >> location [
	"The file I was read from, or nil."

	^ location
]

{ #category : 'accessing' }
TdSessionFile >> messageEntries [
	"The message entries on the active branch."

	^ self entriesOfType: 'message'
]

{ #category : 'accessing' }
TdSessionFile >> messageForEntryId: anId [
	"The message dictionary of a message entry, or nil."

	^ (self entryAt: anId) ifNotNil: [ :entry | entry at: 'message' ifAbsent: [ nil ] ]
]

{ #category : 'accessing' }
TdSessionFile >> messages [
	"The messages on the active branch, as TdMessage objects."

	^ self messageEntries collect: [ :each | TdMessage fromDictionary: (each at: 'message') ]
]

{ #category : 'private' }
TdSessionFile >> parentOf: anEntry [

	^ (anEntry at: 'parentId' ifAbsent: [ nil ]) ifNotNil: [ :parentId |
		  entriesById at: parentId ifAbsent: [ nil ] ]
]

{ #category : 'printing' }
TdSessionFile >> printOn: aStream [

	aStream
		nextPutAll: 'TdSessionFile(';
		nextPutAll: self sessionId asString;
		nextPutAll: ', ';
		print: entries size;
		nextPutAll: ' entries)'
]

{ #category : 'initialization' }
TdSessionFile >> readLines: aCollectionOfStrings [

	| parsed |
	skippedLines := 0.
	parsed := OrderedCollection new.
	aCollectionOfStrings do: [ :line |
		line isAllSeparators ifFalse: [
			[ parsed add: (TdJson fromString: line) ]
				on: TdJsonError
				do: [ skippedLines := skippedLines + 1 ] ] ].
	self setEntries: parsed
]

{ #category : 'accessing' }
TdSessionFile >> sessionId [

	^ header ifNotNil: [ header at: 'id' ifAbsent: [ nil ] ]
]

{ #category : 'initialization' }
TdSessionFile >> setEntries: aCollection [

	skippedLines ifNil: [ skippedLines := 0 ].
	header := aCollection
		          detect: [ :each | each isDictionary and: [ (each at: 'type' ifAbsent: [ nil ]) = 'session' ] ]
		          ifNone: [ nil ].
	entries := (aCollection select: [ :each |
		            each isDictionary and: [ each ~~ header and: [ each includesKey: 'id' ] ] ]) asArray.
	entriesById := Dictionary new.
	entries do: [ :each | entriesById at: (each at: 'id') put: each ].
	activeBranch := nil.
	toolResultsById := nil
]

{ #category : 'initialization' }
TdSessionFile >> setLocation: aFileReference [

	location := aFileReference
]

{ #category : 'accessing' }
TdSessionFile >> size [

	^ entries size
]

{ #category : 'accessing' }
TdSessionFile >> skippedLines [
	"How many lines could not be read as JSON."

	^ skippedLines
]

{ #category : 'accessing' }
TdSessionFile >> tapeDivergence [
	"The data of pi-tape's tape.divergence entry, or nil."

	^ (self customDataOfType: 'tape.divergence') ifEmpty: [ nil ] ifNotEmpty: [ :all | all first ]
]

{ #category : 'accessing' }
TdSessionFile >> tapeHeader [
	"The data of pi-tape's tape.header entry, or nil."

	^ (self customDataOfType: 'tape.header') ifEmpty: [ nil ] ifNotEmpty: [ :all | all first ]
]

{ #category : 'accessing' }
TdSessionFile >> tapeReport [
	"The data of the last tape.report entry, or nil."

	^ (self customDataOfType: 'tape.report') ifEmpty: [ nil ] ifNotEmpty: [ :all | all last ]
]

{ #category : 'accessing' }
TdSessionFile >> tapeSteps [
	"The data of pi-tape's tape.step entries on the active branch."

	^ self customDataOfType: 'tape.step'
]

{ #category : 'accessing' }
TdSessionFile >> toolResultFor: aToolCallId [
	"The toolResult message answering a tool call on the active branch, or nil."

	toolResultsById ifNil: [ toolResultsById := self indexToolResults ].
	^ toolResultsById at: aToolCallId ifAbsent: [ nil ]
]

{ #category : 'private' }
TdSessionFile >> indexToolResults [
	"toolCallId -> toolResult message, over the active branch."

	| index |
	index := Dictionary new.
	self messageEntries do: [ :each |
		| message |
		message := each at: 'message' ifAbsent: [ nil ].
		(message isDictionary and: [ (message at: 'role' ifAbsent: [ nil ]) = 'toolResult' ]) ifTrue: [
			(message at: 'toolCallId' ifAbsent: [ nil ]) ifNotNil: [ :callId | index at: callId put: message ] ] ].
	^ index
]

{ #category : 'accessing' }
TdSessionFile >> version [

	^ header ifNotNil: [ header at: 'version' ifAbsent: [ nil ] ]
]
