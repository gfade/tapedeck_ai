"
I am the difference between two harness states: prompt sections and tools added, removed or changed, and whether the appended prompt text changed. I am a list of TdHarnessChange.

	diff := (baseline harnessStateAt: 1) diff: (fork harnessStateAt: 1).
	diff sectionsAdded.	""#('tapedeck-rules')""
	diff isEmpty.
"
Class {
	#name : 'TdHarnessDiff',
	#superclass : 'Object',
	#instVars : [
		'from',
		'to',
		'changes'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdHarnessDiff class >> from: anOldState to: aNewState [

	^ self new setFrom: anOldState to: aNewState
]

{ #category : 'accessing' }
TdHarnessDiff >> changes [

	^ changes asArray
]

{ #category : 'private' }
TdHarnessDiff >> compare: anOldDictionary with: aNewDictionary subject: aSubject [

	anOldDictionary keysAndValuesDo: [ :key :value |
		(aNewDictionary includesKey: key)
			ifTrue: [
				(TdJson is: value equalTo: (aNewDictionary at: key)) ifFalse: [
					self note: aSubject change: #changed name: key before: value after: (aNewDictionary at: key) ] ]
			ifFalse: [ self note: aSubject change: #removed name: key before: value after: nil ] ].
	aNewDictionary keysAndValuesDo: [ :key :value |
		(anOldDictionary includesKey: key) ifFalse: [
			self note: aSubject change: #added name: key before: nil after: value ] ]
]

{ #category : 'private' }
TdHarnessDiff >> compareStates [

	from content = to content ifFalse: [
		self note: #content change: #changed name: 'content' before: from content after: to content ].
	self compare: from sections with: to sections subject: #section.
	self compare: from tools with: to tools subject: #tool
]

{ #category : 'testing' }
TdHarnessDiff >> contentChanged [

	^ changes anySatisfy: [ :each | each subject = #content ]
]

{ #category : 'printing' }
TdHarnessDiff >> description [

	changes isEmpty ifTrue: [ ^ 'no harness changes' ].
	^ ', ' join: (changes collect: [ :each | each description ])
]

{ #category : 'accessing' }
TdHarnessDiff >> from [

	^ from
]

{ #category : 'testing' }
TdHarnessDiff >> isEmpty [

	^ changes isEmpty
]

{ #category : 'private' }
TdHarnessDiff >> namesOf: aSubject change: aChange [

	^ (changes select: [ :each | each subject = aSubject and: [ each change = aChange ] ]) collect: [
		  :each | each name ]
]

{ #category : 'private' }
TdHarnessDiff >> note: aSubject change: aChange name: aName before: anOldValue after: aNewValue [

	changes add: (TdHarnessChange
			 subject: aSubject
			 change: aChange
			 name: aName
			 before: anOldValue
			 after: aNewValue)
]

{ #category : 'testing' }
TdHarnessDiff >> notEmpty [

	^ self isEmpty not
]

{ #category : 'printing' }
TdHarnessDiff >> printOn: aStream [

	aStream
		nextPutAll: 'TdHarnessDiff(';
		nextPutAll: self description;
		nextPut: $)
]

{ #category : 'accessing' }
TdHarnessDiff >> sectionsAdded [

	^ (self namesOf: #section change: #added) asArray
]

{ #category : 'accessing' }
TdHarnessDiff >> sectionsChanged [

	^ (self namesOf: #section change: #changed) asArray
]

{ #category : 'accessing' }
TdHarnessDiff >> sectionsRemoved [

	^ (self namesOf: #section change: #removed) asArray
]

{ #category : 'initialization' }
TdHarnessDiff >> setFrom: anOldState to: aNewState [

	from := anOldState.
	to := aNewState.
	changes := OrderedCollection new.
	self compareStates
]

{ #category : 'accessing' }
TdHarnessDiff >> to [

	^ to
]

{ #category : 'accessing' }
TdHarnessDiff >> toolsAdded [

	^ (self namesOf: #tool change: #added) asArray
]

{ #category : 'accessing' }
TdHarnessDiff >> toolsChanged [

	^ (self namesOf: #tool change: #changed) asArray
]

{ #category : 'accessing' }
TdHarnessDiff >> toolsRemoved [

	^ (self namesOf: #tool change: #removed) asArray
]
