Extension { #name : 'TdTape' }

{ #category : '*TapeDeck-GT' }
TdTape >> gtJsonFor: aView [

	<gtView>
	^ aView textEditor
		  title: 'JSON';
		  priority: 20;
		  text: [ self asJsonStringPretty ]
]

{ #category : '*TapeDeck-GT' }
TdTape >> gtStepsFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Steps';
		  priority: 10;
		  items: [ self steps ];
		  column: 'Step' text: [ :step | (step at: 'step' ifAbsent: [ nil ]) printString ] width: 40;
		  column: 'Live' text: [ :step | (step at: 'live' ifAbsent: [ nil ]) printString ] width: 50;
		  column: 'Tools' text: [ :step |
			  '; ' join: (((step at: 'tools' ifAbsent: [ #(  ) ]) ifNil: [ #(  ) ]) collect: [ :tool |
					   (TdToolCall fromTapeDictionary: tool) summary ]) ]
]
