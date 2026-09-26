"
I find the first difference between two JSON values, depth first, and describe it with a path in the style of pi-tape's divergence detail: object keys after dots, 0-based indexes in brackets, e.g. content[0].arguments.command.

	diff := TdJsonDiff between: recorded and: live.
	diff hasDifference.
	diff path.
	diff description.	""'content[0].arguments.command: ""npm test"" vs ""./tasks test""'""
"
Class {
	#name : 'TdJsonDiff',
	#superclass : 'Object',
	#instVars : [
		'path',
		'left',
		'right',
		'leftMissing',
		'rightMissing',
		'found'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdJsonDiff class >> between: aValue and: anotherValue [

	^ self new
		  compare: aValue with: anotherValue at: '';
		  yourself
]

{ #category : 'comparing' }
TdJsonDiff >> compare: aValue with: anotherValue at: aPath [
	"Answer whether a difference was found (and remember the first one)."

	(aValue isDictionary and: [ anotherValue isDictionary ]) ifTrue: [
		^ self compareObject: aValue with: anotherValue at: aPath ].
	((self isList: aValue) and: [ self isList: anotherValue ]) ifTrue: [
		^ self compareList: aValue with: anotherValue at: aPath ].
	(self is: aValue sameScalarAs: anotherValue) ifTrue: [ ^ false ].
	^ self foundAt: aPath left: aValue right: anotherValue
]

{ #category : 'private' }
TdJsonDiff >> compareList: aList with: anotherList at: aPath [

	1 to: (aList size min: anotherList size) do: [ :index |
		(self compare: (aList at: index) with: (anotherList at: index) at: (self path: aPath index: index - 1))
			ifTrue: [ ^ true ] ].
	aList size = anotherList size ifTrue: [ ^ false ].
	aList size > anotherList size ifTrue: [
		^ self foundAt: (self path: aPath index: anotherList size) onlyLeft: (aList at: anotherList size + 1) ].
	^ self foundAt: (self path: aPath index: aList size) onlyRight: (anotherList at: aList size + 1)
]

{ #category : 'private' }
TdJsonDiff >> compareObject: aDictionary with: anotherDictionary at: aPath [

	aDictionary keysAndValuesDo: [ :key :value |
		(anotherDictionary includesKey: key)
			ifTrue: [
				(self compare: value with: (anotherDictionary at: key) at: (self path: aPath key: key)) ifTrue: [
					^ true ] ]
			ifFalse: [ ^ self foundAt: (self path: aPath key: key) onlyLeft: value ] ].
	anotherDictionary keysAndValuesDo: [ :key :value |
		(aDictionary includesKey: key) ifFalse: [
			^ self foundAt: (self path: aPath key: key) onlyRight: value ] ].
	^ false
]

{ #category : 'printing' }
TdJsonDiff >> description [

	found ifFalse: [ ^ 'no difference' ].
	^ String streamContents: [ :out |
		  out nextPutAll: (path ifEmpty: [ '(the value)' ]).
		  out nextPutAll: ': '.
		  self print: left missing: leftMissing on: out.
		  out nextPutAll: ' vs '.
		  self print: right missing: rightMissing on: out ]
]

{ #category : 'private' }
TdJsonDiff >> foundAt: aPath left: aValue right: anotherValue [

	path := aPath.
	left := aValue.
	right := anotherValue.
	found := true.
	^ true
]

{ #category : 'private' }
TdJsonDiff >> foundAt: aPath onlyLeft: aValue [

	rightMissing := true.
	^ self foundAt: aPath left: aValue right: nil
]

{ #category : 'private' }
TdJsonDiff >> foundAt: aPath onlyRight: aValue [

	leftMissing := true.
	^ self foundAt: aPath left: nil right: aValue
]

{ #category : 'testing' }
TdJsonDiff >> hasDifference [

	^ found
]

{ #category : 'initialization' }
TdJsonDiff >> initialize [

	super initialize.
	found := false.
	leftMissing := false.
	rightMissing := false.
	path := ''
]

{ #category : 'private' }
TdJsonDiff >> is: aValue sameScalarAs: anotherValue [

	(aValue isDictionary or: [ anotherValue isDictionary ]) ifTrue: [ ^ false ].
	((self isList: aValue) or: [ self isList: anotherValue ]) ifTrue: [ ^ false ].
	^ aValue = anotherValue
]

{ #category : 'private' }
TdJsonDiff >> isList: aValue [

	^ aValue isCollection and: [ aValue isString not and: [ aValue isDictionary not ] ]
]

{ #category : 'accessing' }
TdJsonDiff >> left [

	^ left
]

{ #category : 'accessing' }
TdJsonDiff >> leftMissing [

	^ leftMissing
]

{ #category : 'accessing' }
TdJsonDiff >> path [

	^ path
]

{ #category : 'private' }
TdJsonDiff >> path: aPath index: anIndex [

	^ aPath , '[' , anIndex printString , ']'
]

{ #category : 'private' }
TdJsonDiff >> path: aPath key: aKey [

	^ aPath isEmpty
		  ifTrue: [ aKey asString ]
		  ifFalse: [ aPath , '.' , aKey asString ]
]

{ #category : 'private' }
TdJsonDiff >> print: aValue missing: aBoolean on: aStream [

	aBoolean ifTrue: [ ^ aStream nextPutAll: '(missing)' ].
	aStream nextPutAll: (TdText oneLine: (TdJson toString: aValue) max: 80)
]

{ #category : 'printing' }
TdJsonDiff >> printOn: aStream [

	aStream
		nextPutAll: 'TdJsonDiff(';
		nextPutAll: self description;
		nextPut: $)
]

{ #category : 'accessing' }
TdJsonDiff >> right [

	^ right
]

{ #category : 'accessing' }
TdJsonDiff >> rightMissing [

	^ rightMissing
]
