"
I test the Glamorous Toolkit views of the TapeDeck-GT package by building and rendering them off screen. Outside Glamorous Toolkit, or when TapeDeck-GT is not loaded, my tests are skipped. I refer to GT classes by name only, so this package loads in plain Pharo.
"
Class {
	#name : 'TdGtViewsTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'running' }
TdGtViewsTest >> emptyView [

	^ (Smalltalk globals at: #GtPhlowView) empty
]

{ #category : 'running' }
TdGtViewsTest >> renderedTextsOf: aView [
	"Render the view off screen and answer the texts of its elements."

	| element texts |
	aView asElementDo: [ :each | element := each ].
	element size: 1000 @ 800.
	element forceLayout.
	texts := OrderedCollection new.
	element allChildrenBreadthFirstDo: [ :each |
		(each respondsTo: #text) ifTrue: [ texts add: each text asString ] ].
	^ texts
]

{ #category : 'running' }
TdGtViewsTest >> setUp [

	super setUp.
	(Smalltalk globals includesKey: #GtPhlowView) ifFalse: [ ^ self skip: 'Glamorous Toolkit is not loaded' ].
	(TdRun canUnderstand: #gtTimelineFor:) ifFalse: [ ^ self skip: 'TapeDeck-GT is not loaded' ]
]

{ #category : 'tests' }
TdGtViewsTest >> testListViewsRenderTheirRows [

	| texts |
	texts := self renderedTextsOf: (self fork gtTimelineFor: self emptyView).
	self assert: (texts includes: '$ ls').
	self assert: (texts anySatisfy: [ :each | each beginsWith: '<< went live' ]).
	texts := self renderedTextsOf: (self fork gtHarnessDiffFor: self emptyView).
	self assert: (texts includes: 'tapedeck-rules').
	texts := self renderedTextsOf: (self store gtRunsFor: self emptyView).
	self assert: (texts includes: self baseline id).
	texts := self renderedTextsOf: (self store comparisonTable gtRowsFor: self emptyView).
	self assert: (texts includes: self baseline task)
]

{ #category : 'tests' }
TdGtViewsTest >> testViewsAreBuilt [

	| emptyViewClass |
	emptyViewClass := Smalltalk globals at: #GtPhlowEmptyView.
	{
		(self baseline -> #gtTimelineFor:).
		(self fork -> #gtHarnessDiffFor:).
		((self baseline stepAt: 4) -> #gtRequestFor:).
		((self baseline stepAt: 4) -> #gtResponseFor:).
		((self baseline stepAt: 4) -> #gtToolsFor:).
		(self store -> #gtRunsFor:).
		(self store comparisonTable -> #gtRowsFor:).
		(self store comparisonTable -> #gtSummaryFor:).
		((TdTape fromRun: self baseline) -> #gtStepsFor:).
		((TdTape fromRun: self baseline) -> #gtJsonFor:) } do: [ :each |
		| view |
		view := each key perform: each value with: self emptyView.
		self deny: (view isKindOf: emptyViewClass).
		view asElementDo: [ :element | self assert: element notNil ] ]
]
