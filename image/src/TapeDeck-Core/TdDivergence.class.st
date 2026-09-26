"
I am the first observable difference between a replay (or fork) and its tape, as pi-tape records it in its tape.divergence entry, in run.json and in the tape report (INTERFACES.md §2.5):

- step: the tape step where it happened
- kind: #context, #'tool-args', #'tool-blocked', #'tool-unblocked', #'tool-unknown', #'tool-unwrapped', #forced, #'tape-end' or #'early-end'
- at: 'request', 'tool' or 'turn'
- toolId: the tool call involved, if any
- detail: for #context, a dictionary with index, path, recorded and live
- restoredSnapshot: the snapshot a fork restored before going live
- action: 'live' (a fork went live) or 'stop' (a replay stopped)

	aRun divergence description.	""'step 4 forced at request -> live'""
"
Class {
	#name : 'TdDivergence',
	#superclass : 'Object',
	#instVars : [
		'step',
		'kind',
		'toolId',
		'at',
		'detail',
		'restoredSnapshot',
		'action',
		'data'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdDivergence class >> fromDictionary: aDictionaryOrNil [
	"nil when there is no divergence."

	aDictionaryOrNil isDictionary ifFalse: [ ^ nil ].
	^ self new setFromDictionary: aDictionaryOrNil
]

{ #category : 'accessing' }
TdDivergence >> action [

	^ action
]

{ #category : 'converting' }
TdDivergence >> asDictionary [
	"The tape.divergence data, as recorded."

	^ data
]

{ #category : 'accessing' }
TdDivergence >> at [
	"Where it was seen: 'request', 'tool' or 'turn'."

	^ at
]

{ #category : 'printing' }
TdDivergence >> description [

	^ String streamContents: [ :out |
		  out
			  nextPutAll: 'step ';
			  print: step;
			  space;
			  nextPutAll: kind asString.
		  at ifNotNil: [ out nextPutAll: ' at ' , at asString ].
		  toolId ifNotNil: [ out nextPutAll: ' (tool ' , toolId asString , ')' ].
		  self detailDescription ifNotNil: [ :text | out nextPutAll: ': ' , text ].
		  action ifNotNil: [ out nextPutAll: ' -> ' , action asString ] ]
]

{ #category : 'accessing' }
TdDivergence >> detail [

	^ detail
]

{ #category : 'printing' }
TdDivergence >> detailDescription [
	"A readable form of a context divergence's detail, or nil."

	detail isDictionary ifFalse: [ ^ nil ].
	^ String streamContents: [ :out |
		  (detail at: 'index' ifAbsent: [ nil ]) ifNotNil: [ :index |
			  out nextPutAll: 'message ' , index printString , ' ' ].
		  out
			  nextPutAll: (detail at: 'path' ifAbsent: [ '' ]) asString;
			  nextPutAll: ' recorded ';
			  nextPutAll: (TdText oneLine: (detail at: 'recorded' ifAbsent: [ nil ]) max: 60) printString;
			  nextPutAll: ' live ';
			  nextPutAll: (TdText oneLine: (detail at: 'live' ifAbsent: [ nil ]) max: 60) printString ]
]

{ #category : 'testing' }
TdDivergence >> isForced [

	^ kind = #forced
]

{ #category : 'accessing' }
TdDivergence >> kind [
	"A Symbol such as #context, #forced or #'tool-args'."

	^ kind
]

{ #category : 'printing' }
TdDivergence >> printOn: aStream [

	aStream
		nextPutAll: 'TdDivergence(';
		nextPutAll: self description;
		nextPut: $)
]

{ #category : 'accessing' }
TdDivergence >> restoredSnapshot [

	^ restoredSnapshot
]

{ #category : 'initialization' }
TdDivergence >> setFromDictionary: aDictionary [

	data := aDictionary.
	step := aDictionary at: 'step' ifAbsent: [ nil ].
	kind := (aDictionary at: 'kind' ifAbsent: [ nil ]) ifNotNil: [ :value | value asSymbol ].
	toolId := aDictionary at: 'toolId' ifAbsent: [ nil ].
	at := aDictionary at: 'at' ifAbsent: [ nil ].
	detail := aDictionary at: 'detail' ifAbsent: [ nil ].
	restoredSnapshot := aDictionary at: 'restoredSnapshot' ifAbsent: [ nil ].
	action := aDictionary at: 'action' ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdDivergence >> step [

	^ step
]

{ #category : 'testing' }
TdDivergence >> stopped [
	"A replay stopped here."

	^ action = 'stop'
]

{ #category : 'accessing' }
TdDivergence >> toolId [

	^ toolId
]

{ #category : 'testing' }
TdDivergence >> wentLive [
	"A fork continued on the real model from here."

	^ action = 'live'
]
