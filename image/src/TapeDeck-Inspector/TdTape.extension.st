Extension { #name : 'TdTape' }

{ #category : '*TapeDeck-Inspector' }
TdTape >> inspectionJson [

	<inspectorPresentationOrder: 1 title: 'JSON'>
	^ SpTextPresenter new
		  text: self asJsonStringPretty;
		  beNotEditable;
		  yourself
]

{ #category : '*TapeDeck-Inspector' }
TdTape >> inspectionSteps [

	<inspectorPresentationOrder: 0 title: 'Steps'>
	^ SpTablePresenter new
		  items: self steps;
		  addColumn: ((SpStringTableColumn title: 'Step' evaluated: [ :step | (step at: 'step' ifAbsent: [ nil ]) printString ])
				   width: 40;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Live' evaluated: [ :step | (step at: 'live' ifAbsent: [ nil ]) printString ])
				   width: 50;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Tools' evaluated: [ :step |
					   '; ' join: (((step at: 'tools' ifAbsent: [ #(  ) ]) ifNil: [ #(  ) ]) collect: [ :tool |
							    (TdToolCall fromTapeDictionary: tool) summary ]) ]);
		  addColumn: (SpStringTableColumn title: 'Edits' evaluated: [ :step |
					   (self edits count: [ :edit | (edit at: 'step' ifAbsent: [ nil ]) = (step at: 'step' ifAbsent: [ nil ]) ])
						   printString ]);
		  yourself
]
